package registry

import (
	"context"
	"fmt"
	"log/slog"
	"sort"

	"github.com/drewpayment/orbit/services/build-service/internal/payload"
)

// Cleaner handles registry quota cleanup
type Cleaner struct {
	registryClient *Client
	payloadClient  *payload.RegistryClient
	logger         *slog.Logger
}

// CleanupResult contains the result of a cleanup operation
type CleanupResult struct {
	CleanupPerformed bool
	CurrentUsage     int64
	QuotaBytes       int64
	CleanedImages    []CleanedImage
	Error            string
}

// CleanedImage represents an image that was cleaned up
type CleanedImage struct {
	AppName   string
	Tag       string
	SizeBytes int64
}

// NewCleaner creates a new registry cleaner
func NewCleaner(registryClient *Client, payloadClient *payload.RegistryClient, logger *slog.Logger) *Cleaner {
	if logger == nil {
		logger = slog.Default()
	}
	return &Cleaner{
		registryClient: registryClient,
		payloadClient:  payloadClient,
		logger:         logger,
	}
}

// CleanupIfNeeded checks quota and cleans up if necessary
func (c *Cleaner) CleanupIfNeeded(ctx context.Context, workspaceID string) (*CleanupResult, error) {
	// Get current usage
	usage, err := c.payloadClient.GetRegistryUsage(ctx, workspaceID)
	if err != nil {
		return nil, fmt.Errorf("failed to get registry usage: %w", err)
	}

	c.logger.Info("Checking registry quota",
		"workspaceID", workspaceID,
		"currentBytes", usage.CurrentBytes,
		"quotaBytes", usage.QuotaBytes,
		"percentUsed", float64(usage.CurrentBytes)/float64(usage.QuotaBytes)*100)

	// Check if cleanup needed (> 80% threshold)
	triggerThreshold := usage.QuotaBytes * 80 / 100
	if usage.CurrentBytes < triggerThreshold {
		return &CleanupResult{
			CleanupPerformed: false,
			CurrentUsage:     usage.CurrentBytes,
			QuotaBytes:       usage.QuotaBytes,
		}, nil
	}

	c.logger.Info("Quota exceeded threshold, starting cleanup",
		"threshold", triggerThreshold,
		"current", usage.CurrentBytes)

	// Get all images for workspace
	images, err := c.payloadClient.GetRegistryImages(ctx, workspaceID)
	if err != nil {
		return nil, fmt.Errorf("failed to get registry images: %w", err)
	}

	// Run cleanup algorithm
	cleaned, newUsage := c.runCleanup(ctx, images, usage.CurrentBytes, usage.QuotaBytes)

	return &CleanupResult{
		CleanupPerformed: len(cleaned) > 0,
		CurrentUsage:     newUsage,
		QuotaBytes:       usage.QuotaBytes,
		CleanedImages:    cleaned,
	}, nil
}

// runCleanup executes the cleanup algorithm
func (c *Cleaner) runCleanup(ctx context.Context, images []payload.RegistryImage, currentBytes, quotaBytes int64) ([]CleanedImage, int64) {
	targetBytes := quotaBytes * 70 / 100 // Target 70%

	// Group images by app
	appImages := make(map[string][]payload.RegistryImage)
	for _, img := range images {
		appImages[img.App] = append(appImages[img.App], img)
	}

	// Sort each app's images by pushedAt (newest first)
	for app := range appImages {
		sort.Slice(appImages[app], func(i, j int) bool {
			return appImages[app][i].PushedAt.After(appImages[app][j].PushedAt)
		})
	}

	// Identify candidates (keep 3 most recent per app)
	var candidates []payload.RegistryImage
	for _, imgs := range appImages {
		if len(imgs) > 3 {
			candidates = append(candidates, imgs[3:]...)
		}
	}

	// Sort candidates by pushedAt (oldest first for deletion)
	sort.Slice(candidates, func(i, j int) bool {
		return candidates[i].PushedAt.Before(candidates[j].PushedAt)
	})

	// Delete until under target
	var cleaned []CleanedImage
	for _, img := range candidates {
		if currentBytes <= targetBytes {
			break
		}

		// Check protection rules
		if c.isProtected(img, appImages[img.App]) {
			c.logger.Debug("Skipping protected image",
				"app", img.AppName,
				"tag", img.Tag,
				"reason", "protected by cleanup rules")
			continue
		}

		// Build repository path from app name
		repository := img.AppName

		// Delete from registry
		if err := c.registryClient.DeleteManifest(ctx, repository, img.Digest); err != nil {
			c.logger.Warn("Failed to delete from registry",
				"error", err,
				"app", img.AppName,
				"tag", img.Tag,
				"digest", img.Digest)
			continue
		}

		// Delete from Payload
		if err := c.payloadClient.DeleteRegistryImage(ctx, img.ID); err != nil {
			c.logger.Warn("Failed to delete from Payload",
				"error", err,
				"app", img.AppName,
				"tag", img.Tag,
				"id", img.ID)
			continue
		}

		currentBytes -= img.SizeBytes
		cleaned = append(cleaned, CleanedImage{
			AppName:   img.AppName,
			Tag:       img.Tag,
			SizeBytes: img.SizeBytes,
		})

		c.logger.Info("Deleted image",
			"app", img.AppName,
			"tag", img.Tag,
			"size", img.SizeBytes,
			"newUsage", currentBytes)
	}

	// If still over target, run more aggressive cleanup (keep 2 per app)
	if currentBytes > targetBytes {
		c.logger.Info("Running aggressive cleanup",
			"currentBytes", currentBytes,
			"targetBytes", targetBytes)
		cleaned2, currentBytes := c.aggressiveCleanup(ctx, appImages, currentBytes, targetBytes)
		cleaned = append(cleaned, cleaned2...)
		return cleaned, currentBytes
	}

	return cleaned, currentBytes
}

// aggressiveCleanup reduces to 2 tags per app
func (c *Cleaner) aggressiveCleanup(ctx context.Context, appImages map[string][]payload.RegistryImage, currentBytes, targetBytes int64) ([]CleanedImage, int64) {
	var candidates []payload.RegistryImage
	for _, imgs := range appImages {
		if len(imgs) > 2 {
			candidates = append(candidates, imgs[2:]...)
		}
	}

	sort.Slice(candidates, func(i, j int) bool {
		return candidates[i].PushedAt.Before(candidates[j].PushedAt)
	})

	var cleaned []CleanedImage
	for _, img := range candidates {
		if currentBytes <= targetBytes {
			break
		}

		if c.isProtected(img, appImages[img.App]) {
			c.logger.Debug("Skipping protected image in aggressive cleanup",
				"app", img.AppName,
				"tag", img.Tag,
				"reason", "protected by cleanup rules")
			continue
		}

		repository := img.AppName

		if err := c.registryClient.DeleteManifest(ctx, repository, img.Digest); err != nil {
			c.logger.Warn("Failed to delete from registry in aggressive cleanup",
				"error", err,
				"app", img.AppName,
				"tag", img.Tag)
			continue
		}

		if err := c.payloadClient.DeleteRegistryImage(ctx, img.ID); err != nil {
			c.logger.Warn("Failed to delete from Payload in aggressive cleanup",
				"error", err,
				"app", img.AppName,
				"tag", img.Tag)
			continue
		}

		currentBytes -= img.SizeBytes
		cleaned = append(cleaned, CleanedImage{
			AppName:   img.AppName,
			Tag:       img.Tag,
			SizeBytes: img.SizeBytes,
		})

		c.logger.Info("Deleted image (aggressive)",
			"app", img.AppName,
			"tag", img.Tag,
			"size", img.SizeBytes,
			"newUsage", currentBytes)
	}

	return cleaned, currentBytes
}

// isProtected checks if an image should not be deleted
func (c *Cleaner) isProtected(img payload.RegistryImage, appImages []payload.RegistryImage) bool {
	// Never delete the only image for an app
	if len(appImages) <= 1 {
		c.logger.Debug("Image protected: only image for app",
			"app", img.AppName,
			"tag", img.Tag)
		return true
	}

	// Never delete "latest" if it's the sole remaining tag
	if img.Tag == "latest" && len(appImages) <= 2 {
		c.logger.Debug("Image protected: latest tag with only 2 images",
			"app", img.AppName,
			"tag", img.Tag)
		return true
	}

	return false
}
