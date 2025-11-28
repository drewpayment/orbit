package services

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"
)

// TokenService defines the interface for fetching GitHub installation tokens
type TokenService interface {
	// GetInstallationToken fetches a GitHub token for the given installation ID
	GetInstallationToken(ctx context.Context, installationID string) (string, error)
}

// PayloadTokenService fetches tokens from the Payload API
type PayloadTokenService struct {
	orbitAPIURL string
	apiKey      string
	httpClient  *http.Client
}

// NewPayloadTokenService creates a new token service
func NewPayloadTokenService(orbitAPIURL, apiKey string) *PayloadTokenService {
	return &PayloadTokenService{
		orbitAPIURL: orbitAPIURL,
		apiKey:      apiKey,
		httpClient: &http.Client{
			Timeout: 30 * time.Second,
		},
	}
}

type tokenRequest struct {
	InstallationID string `json:"installationId"`
}

type tokenResponse struct {
	Token     string `json:"token"`
	ExpiresAt string `json:"expiresAt"`
}

type errorResponse struct {
	Error string `json:"error"`
	Code  string `json:"code"`
}

// GetInstallationToken fetches a GitHub token for the given installation ID
func (s *PayloadTokenService) GetInstallationToken(ctx context.Context, installationID string) (string, error) {
	url := fmt.Sprintf("%s/api/internal/github/token", s.orbitAPIURL)

	reqBody, err := json.Marshal(tokenRequest{InstallationID: installationID})
	if err != nil {
		return "", fmt.Errorf("failed to marshal request: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, "POST", url, bytes.NewReader(reqBody))
	if err != nil {
		return "", fmt.Errorf("failed to create request: %w", err)
	}

	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-API-Key", s.apiKey)

	resp, err := s.httpClient.Do(req)
	if err != nil {
		return "", fmt.Errorf("request failed: %w", err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", fmt.Errorf("failed to read response: %w", err)
	}

	switch resp.StatusCode {
	case http.StatusOK:
		var tokenResp tokenResponse
		if err := json.Unmarshal(body, &tokenResp); err != nil {
			return "", fmt.Errorf("failed to parse response: %w", err)
		}
		return tokenResp.Token, nil

	case http.StatusUnauthorized:
		return "", fmt.Errorf("unauthorized: invalid API key")

	case http.StatusNotFound:
		return "", fmt.Errorf("installation not found: %s", installationID)

	case http.StatusGone:
		return "", fmt.Errorf("token expired for installation %s, refresh workflow may be stalled", installationID)

	default:
		var errResp errorResponse
		if err := json.Unmarshal(body, &errResp); err != nil {
			return "", fmt.Errorf("API error (status %d): failed to parse error response", resp.StatusCode)
		}
		return "", fmt.Errorf("API error (status %d): %s", resp.StatusCode, errResp.Error)
	}
}
