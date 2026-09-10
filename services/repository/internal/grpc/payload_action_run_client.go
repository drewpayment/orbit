package grpc

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"time"
)

// ActionRunWorkspace is the workspace a run belongs to. Slug and Name are
// empty when the route could not populate them.
type ActionRunWorkspace struct {
	ID   string
	Slug string
	Name string
}

// ActionRunUser is the user who triggered a run. Email and Name are empty when
// the route could not populate them; the whole value is absent for a run with
// no human trigger (an automation).
type ActionRunUser struct {
	ID    string
	Email string
	Name  string
}

// ActionRunData is the narrow identity view of an `action-runs` row that
// StartScaffolderRun needs: enough to prove the run belongs to the caller and
// to seed the run's user/workspace expression context.
//
// The route deliberately never returns inputs, outputs or logs, which can hold
// `ui:secret` parameter values.
type ActionRunData struct {
	ID                string
	Workspace         ActionRunWorkspace
	TemplateVersionID string
	DryRun            bool
	Status            string
	TriggeredBy       *ActionRunUser
}

// ActionRunClientInterface reads the identity view of an action run.
type ActionRunClientInterface interface {
	GetActionRun(ctx context.Context, runID string) (*ActionRunData, error)
}

// ErrActionRunNotFound is returned when a run id doesn't resolve, so the
// handler can answer NotFound rather than Internal.
var ErrActionRunNotFound = errors.New("action run not found")

// ErrIdentityRouteUnavailable is returned when a 404 came from the framework
// rather than from the route — i.e. the route is not deployed. It maps to
// FailedPrecondition, because the fix is deploying orbit-www, not retrying.
var ErrIdentityRouteUnavailable = errors.New(
	"action-runs identity route unavailable — is orbit-www up to date?")

// isJSONErrorBody reports whether a 404 body is this API's own
// {"error": "..."} shape. Next.js answers an unrouted path with HTML, so the
// body is what separates "no such record" from "no such route".
func isJSONErrorBody(body []byte) bool {
	var probe struct {
		Error *string `json:"error"`
	}
	if err := json.Unmarshal(body, &probe); err != nil {
		return false
	}
	return probe.Error != nil
}

// PayloadActionRunClient reads action runs from orbit-www's internal API.
//
// Contract: GET {baseURL}/api/internal/action-runs/{id} with an X-API-Key
// header, answering
//
//	{"run":{"id":…,"workspace":{"id","slug","name"},"templateVersion":string|null,
//	        "dryRun":bool,"status":…,"triggeredBy":{"id","email","name"}|null}}
//
// and 404 {"error":"action run not found"}. `slug`, `name` and `email` may be
// null when Payload could not populate the relationship.
type PayloadActionRunClient struct {
	baseURL    string
	apiKey     string
	httpClient *http.Client
}

// NewPayloadActionRunClient builds a client against orbit-www.
func NewPayloadActionRunClient(baseURL, apiKey string) *PayloadActionRunClient {
	return &PayloadActionRunClient{
		baseURL:    baseURL,
		apiKey:     apiKey,
		httpClient: &http.Client{Timeout: 15 * time.Second},
	}
}

type actionRunEnvelope struct {
	Run struct {
		ID        string `json:"id"`
		Workspace struct {
			ID   string  `json:"id"`
			Slug *string `json:"slug"`
			Name *string `json:"name"`
		} `json:"workspace"`
		TemplateVersion *string `json:"templateVersion"`
		DryRun          bool    `json:"dryRun"`
		Status          string  `json:"status"`
		TriggeredBy     *struct {
			ID    string  `json:"id"`
			Email *string `json:"email"`
			Name  *string `json:"name"`
		} `json:"triggeredBy"`
	} `json:"run"`
}

// GetActionRun fetches one run's identity view.
func (c *PayloadActionRunClient) GetActionRun(ctx context.Context, runID string) (*ActionRunData, error) {
	if runID == "" {
		return nil, errors.New("action run id required")
	}

	u := c.baseURL + "/api/internal/action-runs/" + url.PathEscape(runID)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("X-API-Key", c.apiKey)

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer func() { _ = resp.Body.Close() }()

	body, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))

	if resp.StatusCode == http.StatusNotFound {
		// A 404 from the route means "no such run". A 404 because the route
		// itself does not exist (orbit-www predates it) is a deployment
		// problem, and reporting it as "run not found" would send whoever
		// debugs it looking for a missing record instead of a missing route.
		if !isJSONErrorBody(body) {
			return nil, ErrIdentityRouteUnavailable
		}
		return nil, ErrActionRunNotFound
	}
	if resp.StatusCode/100 != 2 {
		return nil, fmt.Errorf("get action run: HTTP %d: %s", resp.StatusCode, string(body))
	}

	var env actionRunEnvelope
	if err := json.Unmarshal(body, &env); err != nil {
		return nil, fmt.Errorf("get action run: decode response: %w", err)
	}
	if env.Run.ID == "" {
		return nil, fmt.Errorf("get action run %s: response carried no run", runID)
	}

	out := &ActionRunData{
		ID: env.Run.ID,
		Workspace: ActionRunWorkspace{
			ID:   env.Run.Workspace.ID,
			Slug: derefString(env.Run.Workspace.Slug),
			Name: derefString(env.Run.Workspace.Name),
		},
		TemplateVersionID: derefString(env.Run.TemplateVersion),
		DryRun:            env.Run.DryRun,
		Status:            env.Run.Status,
	}
	if env.Run.TriggeredBy != nil {
		out.TriggeredBy = &ActionRunUser{
			ID:    env.Run.TriggeredBy.ID,
			Email: derefString(env.Run.TriggeredBy.Email),
			Name:  derefString(env.Run.TriggeredBy.Name),
		}
	}
	return out, nil
}

// derefString flattens a nullable JSON string to "".
func derefString(s *string) string {
	if s == nil {
		return ""
	}
	return *s
}
