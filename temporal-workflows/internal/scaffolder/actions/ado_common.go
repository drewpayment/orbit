package actions

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/drewpayment/orbit/temporal-workflows/internal/scaffolder"
	"github.com/drewpayment/orbit/temporal-workflows/internal/services"
)

// defaultADOClientFactory wraps services.NewADOWriteClient. Shared by all
// three ado:* actions' constructors.
func defaultADOClientFactory() ADOClientFactory {
	return func(baseURL, authHeader string) ADORepoClient {
		return services.NewADOWriteClient(baseURL, authHeader, nil)
	}
}

// resolveADOConnection resolves a git-connections id to the organization and
// Authorization header the ado:* actions need to call the ADO REST API.
// connectionID is assumed already validated as non-empty by the caller's
// input parsing.
//
// A missing or misconfigured connection (services.ErrConnectionNotFound /
// ErrConnectionNotConfigured) is the caller's input being wrong (a stale or
// deleted connection id), so it is wrapped in scaffolder.ErrInvalidInput —
// not retryable. Any other failure (network, orbit-www 5xx) is left as a
// plain, retryable error.
func resolveADOConnection(ctx context.Context, connectionClient ADOConnectionClient, connectionID, actionName string) (org, authHeader, baseURL string, err error) {
	if connectionClient == nil {
		return "", "", "", fmt.Errorf("%s: no ADO connection client configured", actionName)
	}
	conn, err := connectionClient.GetConnectionToken(ctx, connectionID)
	if err != nil {
		if errors.Is(err, services.ErrConnectionNotFound) || errors.Is(err, services.ErrConnectionNotConfigured) {
			return "", "", "", fmt.Errorf("%s: %w: %v", actionName, scaffolder.ErrInvalidInput, err)
		}
		return "", "", "", fmt.Errorf("%s: resolve connection: %w", actionName, err)
	}
	return conn.Organization, services.BuildADOAuthHeader(conn.AuthMode, conn.Token), conn.BaseURL, nil
}

// wrapADOError maps an ADORepoClient error to the action's error shape:
// services.ErrADOInvalidInput (a caller-input-caused 4xx) becomes
// scaffolder.ErrInvalidInput (non-retryable); anything else (5xx, network)
// stays a plain, retryable error.
func wrapADOError(actionName string, err error) error {
	if errors.Is(err, services.ErrADOInvalidInput) {
		return fmt.Errorf("%s: %w: %v", actionName, scaffolder.ErrInvalidInput, err)
	}
	return fmt.Errorf("%s: %w", actionName, err)
}

// requireNonEmpty is a small shared validator: returns a scaffolder.ErrInvalidInput
// error naming the first missing field, or nil if all are present. fields is
// ordered so the error is deterministic.
func requireNonEmpty(actionName string, fields map[string]string, order []string) error {
	for _, name := range order {
		if strings.TrimSpace(fields[name]) == "" {
			return fmt.Errorf("%s: %w: `%s` is required", actionName, scaffolder.ErrInvalidInput, name)
		}
	}
	return nil
}
