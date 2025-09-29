/**
 * Page Domain Models for Repository Service
 *
 * This file contains domain models for page management including:
 * - Page: Core page entity with content, metadata, and settings
 * - PageTemplate: Template entities for page rendering
 * - PageAsset: Asset management for pages
 *
 * Constitutional Requirements:
 * - Rich domain models with business logic
 * - Multi-format content support (HTML, Markdown, MDX)
 * - Template engine integration
 * - SEO optimization and meta management
 * - Multi-tenant workspace isolation
 * - Performance optimization features
 */

package domain

import (
	"time"

	"github.com/google/uuid"
)

// Page represents a page entity in the system
type Page struct {
	ID            uuid.UUID  `json:"id" db:"id"`
	WorkspaceID   uuid.UUID  `json:"workspace_id" db:"workspace_id"`
	Title         string     `json:"title" db:"title"`
	Slug          string     `json:"slug" db:"slug"`
	Path          string     `json:"path" db:"path"`
	Content       string     `json:"content" db:"content"`
	Format        string     `json:"format" db:"format"` // html, markdown, mdx, json, yaml
	Type          string     `json:"type" db:"type"`     // static, dynamic, landing, template, api
	Status        string     `json:"status" db:"status"` // draft, published, archived, deleted
	TemplateID    *uuid.UUID `json:"template_id" db:"template_id"`
	ParentID      *uuid.UUID `json:"parent_id" db:"parent_id"`
	Description   string     `json:"description" db:"description"`
	Keywords      []string   `json:"keywords" db:"keywords"`
	Tags          []string   `json:"tags" db:"tags"`
	ViewCount     int64      `json:"view_count" db:"view_count"`
	UniqueViewers int64      `json:"unique_viewers" db:"unique_viewers"`
	ShareCount    int64      `json:"share_count" db:"share_count"`
	BookmarkCount int64      `json:"bookmark_count" db:"bookmark_count"`
	SortOrder     int        `json:"sort_order" db:"sort_order"`
	IsIndexable   bool       `json:"is_indexable" db:"is_indexable"`
	RequireAuth   bool       `json:"require_auth" db:"require_auth"`
	IsFeatured    bool       `json:"is_featured" db:"is_featured"`
	IsPinned      bool       `json:"is_pinned" db:"is_pinned"`

	// SEO fields
	SEOTitle       string   `json:"seo_title" db:"seo_title"`
	SEODescription string   `json:"seo_description" db:"seo_description"`
	SEOKeywords    []string `json:"seo_keywords" db:"seo_keywords"`
	CanonicalURL   string   `json:"canonical_url" db:"canonical_url"`
	MetaRobots     string   `json:"meta_robots" db:"meta_robots"`

	// Performance and caching
	CacheEnabled  bool          `json:"cache_enabled" db:"cache_enabled"`
	CacheDuration time.Duration `json:"cache_duration" db:"cache_duration"`

	// Scheduling
	PublishAt    *time.Time `json:"publish_at" db:"publish_at"`
	PublishedAt  *time.Time `json:"published_at" db:"published_at"`
	LastViewedAt *time.Time `json:"last_viewed_at" db:"last_viewed_at"`

	// Audit fields
	CreatedAt time.Time `json:"created_at" db:"created_at"`
	UpdatedAt time.Time `json:"updated_at" db:"updated_at"`
	CreatedBy uuid.UUID `json:"created_by" db:"created_by"`
	UpdatedBy uuid.UUID `json:"updated_by" db:"updated_by"`

	// Computed/loaded fields
	Workspace *Workspace    `json:"workspace,omitempty" db:"-"`
	Template  *PageTemplate `json:"template,omitempty" db:"-"`
	Parent    *Page         `json:"parent,omitempty" db:"-"`
	Children  []*Page       `json:"children,omitempty" db:"-"`
	Creator   *User         `json:"creator,omitempty" db:"-"`
	Updater   *User         `json:"updater,omitempty" db:"-"`
	Assets    []*PageAsset  `json:"assets,omitempty" db:"-"`
}

// PageTemplate represents a page template entity
type PageTemplate struct {
	ID           uuid.UUID `json:"id" db:"id"`
	WorkspaceID  uuid.UUID `json:"workspace_id" db:"workspace_id"`
	Name         string    `json:"name" db:"name"`
	Slug         string    `json:"slug" db:"slug"`
	Description  string    `json:"description" db:"description"`
	Type         string    `json:"type" db:"type"`     // layout, page, partial, component, email
	Format       string    `json:"format" db:"format"` // handlebars, mustache, go, liquid
	Content      string    `json:"content" db:"content"`
	Variables    []string  `json:"variables" db:"variables"`
	Dependencies []string  `json:"dependencies" db:"dependencies"`
	Tags         []string  `json:"tags" db:"tags"`
	UsageCount   int       `json:"usage_count" db:"usage_count"`
	Active       bool      `json:"is_active" db:"is_active"`
	IsDefault    bool      `json:"is_default" db:"is_default"`
	Version      string    `json:"version" db:"version"`

	// Audit fields
	CreatedAt time.Time `json:"created_at" db:"created_at"`
	UpdatedAt time.Time `json:"updated_at" db:"updated_at"`
	CreatedBy uuid.UUID `json:"created_by" db:"created_by"`
	UpdatedBy uuid.UUID `json:"updated_by" db:"updated_by"`

	// Computed/loaded fields
	Workspace *Workspace `json:"workspace,omitempty" db:"-"`
	Creator   *User      `json:"creator,omitempty" db:"-"`
	Updater   *User      `json:"updater,omitempty" db:"-"`
	Pages     []*Page    `json:"pages,omitempty" db:"-"`
}

// PageAsset represents an asset used by pages
type PageAsset struct {
	ID           uuid.UUID `json:"id" db:"id"`
	PageID       uuid.UUID `json:"page_id" db:"page_id"`
	WorkspaceID  uuid.UUID `json:"workspace_id" db:"workspace_id"`
	Name         string    `json:"name" db:"name"`
	Filename     string    `json:"filename" db:"filename"`
	MimeType     string    `json:"mime_type" db:"mime_type"`
	Size         int64     `json:"size" db:"size"`
	Type         string    `json:"type" db:"type"` // image, video, document, font, css, javascript, other
	URL          string    `json:"url" db:"url"`
	CDNUrl       string    `json:"cdn_url" db:"cdn_url"`
	ThumbnailURL string    `json:"thumbnail_url" db:"thumbnail_url"`
	Alt          string    `json:"alt" db:"alt"`
	Title        string    `json:"title" db:"title"`
	Description  string    `json:"description" db:"description"`
	Tags         []string  `json:"tags" db:"tags"`
	UsageCount   int       `json:"usage_count" db:"usage_count"`
	IsOptimized  bool      `json:"is_optimized" db:"is_optimized"`
	Hash         string    `json:"hash" db:"hash"`

	// Audit fields
	CreatedAt  time.Time `json:"created_at" db:"created_at"`
	UpdatedAt  time.Time `json:"updated_at" db:"updated_at"`
	UploadedBy uuid.UUID `json:"uploaded_by" db:"uploaded_by"`

	// Computed/loaded fields
	Page     *Page `json:"page,omitempty" db:"-"`
	Uploader *User `json:"uploader,omitempty" db:"-"`
}

// Business Logic Methods for Page

// IsPublished returns true if the page is published
func (p *Page) IsPublished() bool {
	return p.Status == "published"
}

// IsDraft returns true if the page is in draft status
func (p *Page) IsDraft() bool {
	return p.Status == "draft"
}

// IsArchived returns true if the page is archived
func (p *Page) IsArchived() bool {
	return p.Status == "archived"
}

// IsDeleted returns true if the page is deleted
func (p *Page) IsDeleted() bool {
	return p.Status == "deleted"
}

// IsScheduledForPublishing returns true if the page is scheduled for future publishing
func (p *Page) IsScheduledForPublishing() bool {
	return p.PublishAt != nil && p.PublishAt.After(time.Now()) && !p.IsPublished()
}

// IsStatic returns true if the page is a static page
func (p *Page) IsStatic() bool {
	return p.Type == "static"
}

// IsDynamic returns true if the page is a dynamic page
func (p *Page) IsDynamic() bool {
	return p.Type == "dynamic"
}

// IsLanding returns true if the page is a landing page
func (p *Page) IsLanding() bool {
	return p.Type == "landing"
}

// IsTemplate returns true if the page is a template
func (p *Page) IsTemplate() bool {
	return p.Type == "template"
}

// IsAPI returns true if the page serves API content
func (p *Page) IsAPI() bool {
	return p.Type == "api"
}

// HasTemplate returns true if the page uses a template
func (p *Page) HasTemplate() bool {
	return p.TemplateID != nil
}

// HasParent returns true if the page has a parent page
func (p *Page) HasParent() bool {
	return p.ParentID != nil
}

// HasChildren returns true if the page has child pages
func (p *Page) HasChildren() bool {
	return len(p.Children) > 0
}

// GetEngagementScore calculates an engagement score based on views, shares, and bookmarks
func (p *Page) GetEngagementScore() float64 {
	if p.ViewCount == 0 {
		return 0
	}
	totalEngagement := p.ShareCount + p.BookmarkCount
	return float64(totalEngagement) / float64(p.ViewCount) * 100
}

// GetPopularityScore calculates a popularity score based on various metrics
func (p *Page) GetPopularityScore() float64 {
	score := 0.0

	// Base score for views
	if p.ViewCount > 0 {
		score += float64(p.ViewCount) * 0.1
	}

	// Engagement multiplier
	engagementRate := p.GetEngagementScore()
	if engagementRate > 0 {
		score *= (1 + engagementRate/100)
	}

	// Recency factor
	if p.PublishedAt != nil {
		daysSincePublish := time.Since(*p.PublishedAt).Hours() / 24
		if daysSincePublish < 7 {
			score *= 1.5 // Boost for recent content
		} else if daysSincePublish < 30 {
			score *= 1.2
		}
	}

	// Featured and pinned multipliers
	if p.IsFeatured {
		score *= 1.3
	}
	if p.IsPinned {
		score *= 1.2
	}

	return score
}

// HasTag returns true if the page has the specified tag
func (p *Page) HasTag(tag string) bool {
	for _, t := range p.Tags {
		if t == tag {
			return true
		}
	}
	return false
}

// HasKeyword returns true if the page has the specified keyword
func (p *Page) HasKeyword(keyword string) bool {
	for _, k := range p.Keywords {
		if k == keyword {
			return true
		}
	}
	return false
}

// AddTag adds a tag if it doesn't already exist
func (p *Page) AddTag(tag string) {
	if !p.HasTag(tag) {
		p.Tags = append(p.Tags, tag)
	}
}

// RemoveTag removes a tag if it exists
func (p *Page) RemoveTag(tag string) {
	for i, t := range p.Tags {
		if t == tag {
			p.Tags = append(p.Tags[:i], p.Tags[i+1:]...)
			break
		}
	}
}

// AddKeyword adds a keyword if it doesn't already exist
func (p *Page) AddKeyword(keyword string) {
	if !p.HasKeyword(keyword) {
		p.Keywords = append(p.Keywords, keyword)
	}
}

// RemoveKeyword removes a keyword if it exists
func (p *Page) RemoveKeyword(keyword string) {
	for i, k := range p.Keywords {
		if k == keyword {
			p.Keywords = append(p.Keywords[:i], p.Keywords[i+1:]...)
			break
		}
	}
}

// GetSEOTitle returns the SEO title or falls back to the regular title
func (p *Page) GetSEOTitle() string {
	if p.SEOTitle != "" {
		return p.SEOTitle
	}
	return p.Title
}

// GetSEODescription returns the SEO description or falls back to the regular description
func (p *Page) GetSEODescription() string {
	if p.SEODescription != "" {
		return p.SEODescription
	}
	return p.Description
}

// GetSEOKeywords returns the SEO keywords or falls back to the regular keywords
func (p *Page) GetSEOKeywords() []string {
	if len(p.SEOKeywords) > 0 {
		return p.SEOKeywords
	}
	return p.Keywords
}

// CanBeAccessedBy returns true if the user can access this page
func (p *Page) CanBeAccessedBy(userID uuid.UUID, workspace *Workspace) bool {
	// Page creator can always access
	if p.CreatedBy == userID {
		return true
	}

	// Check if page requires authentication
	if p.RequireAuth {
		return workspace != nil && workspace.HasMember(userID)
	}

	// Published pages are generally accessible
	if p.IsPublished() {
		return true
	}

	// Draft pages only accessible to creator and workspace admins
	if workspace == nil {
		return false
	}

	member := workspace.GetMember(userID)
	if member == nil {
		return false
	}

	return member.Role == WorkspaceRoleOwner ||
		member.Role == WorkspaceRoleAdmin ||
		p.CreatedBy == userID
}

// CanBeModifiedBy returns true if the user can modify this page
func (p *Page) CanBeModifiedBy(userID uuid.UUID, workspace *Workspace) bool {
	// Page creator can modify
	if p.CreatedBy == userID {
		return true
	}

	// Check workspace permissions
	if workspace == nil {
		return false
	}

	member := workspace.GetMember(userID)
	if member == nil {
		return false
	}

	return member.Role == WorkspaceRoleOwner ||
		member.Role == WorkspaceRoleAdmin
}

// CanBeDeletedBy returns true if the user can delete this page
func (p *Page) CanBeDeletedBy(userID uuid.UUID, workspace *Workspace) bool {
	// Page creator can delete
	if p.CreatedBy == userID {
		return true
	}

	// Check workspace permissions
	if workspace == nil {
		return false
	}

	member := workspace.GetMember(userID)
	if member == nil {
		return false
	}

	return member.Role == WorkspaceRoleOwner ||
		member.Role == WorkspaceRoleAdmin
}

// Business Logic Methods for PageTemplate

// IsActive returns true if the template is active
func (pt *PageTemplate) IsActive() bool {
	return pt.Active
}

// IsLayout returns true if the template is a layout template
func (pt *PageTemplate) IsLayout() bool {
	return pt.Type == "layout"
}

// IsPage returns true if the template is a page template
func (pt *PageTemplate) IsPage() bool {
	return pt.Type == "page"
}

// IsPartial returns true if the template is a partial template
func (pt *PageTemplate) IsPartial() bool {
	return pt.Type == "partial"
}

// IsComponent returns true if the template is a component template
func (pt *PageTemplate) IsComponent() bool {
	return pt.Type == "component"
}

// IsEmail returns true if the template is an email template
func (pt *PageTemplate) IsEmail() bool {
	return pt.Type == "email"
}

// HasTag returns true if the template has the specified tag
func (pt *PageTemplate) HasTag(tag string) bool {
	for _, t := range pt.Tags {
		if t == tag {
			return true
		}
	}
	return false
}

// HasVariable returns true if the template has the specified variable
func (pt *PageTemplate) HasVariable(variable string) bool {
	for _, v := range pt.Variables {
		if v == variable {
			return true
		}
	}
	return false
}

// HasDependency returns true if the template has the specified dependency
func (pt *PageTemplate) HasDependency(dependency string) bool {
	for _, d := range pt.Dependencies {
		if d == dependency {
			return true
		}
	}
	return false
}

// GetPopularityScore calculates a popularity score based on usage
func (pt *PageTemplate) GetPopularityScore() float64 {
	score := float64(pt.UsageCount)

	// Default template bonus
	if pt.IsDefault {
		score *= 1.5
	}

	// Active template bonus
	if pt.Active {
		score *= 1.2
	}

	return score
}

// CanBeUsedBy returns true if the user can use this template
func (pt *PageTemplate) CanBeUsedBy(userID uuid.UUID, workspace *Workspace) bool {
	// Template must be active
	if !pt.Active {
		return false
	}

	// Check workspace membership
	return workspace != nil && workspace.HasMember(userID)
}

// CanBeModifiedBy returns true if the user can modify this template
func (pt *PageTemplate) CanBeModifiedBy(userID uuid.UUID, workspace *Workspace) bool {
	// Template creator can modify
	if pt.CreatedBy == userID {
		return true
	}

	// Check workspace permissions
	if workspace == nil {
		return false
	}

	member := workspace.GetMember(userID)
	if member == nil {
		return false
	}

	return member.Role == WorkspaceRoleOwner ||
		member.Role == WorkspaceRoleAdmin
}

// Business Logic Methods for PageAsset

// IsImage returns true if the asset is an image
func (pa *PageAsset) IsImage() bool {
	return pa.Type == "image"
}

// IsVideo returns true if the asset is a video
func (pa *PageAsset) IsVideo() bool {
	return pa.Type == "video"
}

// IsDocument returns true if the asset is a document
func (pa *PageAsset) IsDocument() bool {
	return pa.Type == "document"
}

// IsFont returns true if the asset is a font
func (pa *PageAsset) IsFont() bool {
	return pa.Type == "font"
}

// IsCSS returns true if the asset is a CSS file
func (pa *PageAsset) IsCSS() bool {
	return pa.Type == "css"
}

// IsJavaScript returns true if the asset is a JavaScript file
func (pa *PageAsset) IsJavaScript() bool {
	return pa.Type == "javascript"
}

// HasThumbnail returns true if the asset has a thumbnail
func (pa *PageAsset) HasThumbnail() bool {
	return pa.ThumbnailURL != ""
}

// HasCDNUrl returns true if the asset has a CDN URL
func (pa *PageAsset) HasCDNUrl() bool {
	return pa.CDNUrl != ""
}

// GetDisplayURL returns the best URL for displaying the asset
func (pa *PageAsset) GetDisplayURL() string {
	if pa.CDNUrl != "" {
		return pa.CDNUrl
	}
	return pa.URL
}

// GetSizeInMB returns the size in megabytes
func (pa *PageAsset) GetSizeInMB() float64 {
	return float64(pa.Size) / (1024 * 1024)
}

// GetSizeInKB returns the size in kilobytes
func (pa *PageAsset) GetSizeInKB() float64 {
	return float64(pa.Size) / 1024
}

// IsLargeFile returns true if the file is larger than 1MB
func (pa *PageAsset) IsLargeFile() bool {
	return pa.Size > 1024*1024
}

// HasTag returns true if the asset has the specified tag
func (pa *PageAsset) HasTag(tag string) bool {
	for _, t := range pa.Tags {
		if t == tag {
			return true
		}
	}
	return false
}

// NeedsOptimization returns true if the asset should be optimized
func (pa *PageAsset) NeedsOptimization() bool {
	return !pa.IsOptimized && (pa.IsImage() || pa.IsVideo()) && pa.IsLargeFile()
}

// CanBeAccessedBy returns true if the user can access this asset
func (pa *PageAsset) CanBeAccessedBy(userID uuid.UUID, page *Page, workspace *Workspace) bool {
	// If the user can access the page, they can access its assets
	return page.CanBeAccessedBy(userID, workspace)
}

// CanBeModifiedBy returns true if the user can modify this asset
func (pa *PageAsset) CanBeModifiedBy(userID uuid.UUID, page *Page, workspace *Workspace) bool {
	// Asset uploader can modify
	if pa.UploadedBy == userID {
		return true
	}

	// If the user can modify the page, they can modify its assets
	return page.CanBeModifiedBy(userID, workspace)
}
