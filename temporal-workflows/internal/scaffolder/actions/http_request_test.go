package actions

import (
	"context"
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/drewpayment/orbit/temporal-workflows/internal/scaffolder"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func allowAll(net.IP) error { return nil }

func runCtx() scaffolder.ActionRunContext {
	return scaffolder.NewActionRunContext(scaffolder.ActionRunContext{RunID: "run-1"})
}

type httpOutput struct {
	Status    int               `json:"status"`
	Headers   map[string]string `json:"headers"`
	Body      string            `json:"body"`
	Truncated bool              `json:"truncated"`
}

func execHTTP(t *testing.T, a *HTTPRequest, input string) (httpOutput, error) {
	t.Helper()
	raw, err := a.Execute(context.Background(), runCtx(), json.RawMessage(input))
	if err != nil {
		return httpOutput{}, err
	}
	var out httpOutput
	require.NoError(t, json.Unmarshal(raw, &out))
	return out, nil
}

func TestHTTPRequestSchemasAndRegistration(t *testing.T) {
	a := NewHTTPRequest()
	assert.Equal(t, "http:request", a.Name())
	var probe map[string]any
	require.NoError(t, json.Unmarshal(a.InputSchema(), &probe))
	require.NoError(t, json.Unmarshal(a.OutputSchema(), &probe))

	r := scaffolder.NewRegistry(a)
	d, ok := r.Descriptor("http:request")
	require.True(t, ok)
	assert.Equal(t, "http", d.Family)
	assert.False(t, d.SupportsPlan, "http:request cannot be dry-run")

	keys, err := r.OutputKeys("http:request")
	require.NoError(t, err)
	assert.ElementsMatch(t, []string{"status", "headers", "body", "truncated"}, keys)
}

func TestHTTPRequestPlanIsUnsupported(t *testing.T) {
	_, err := NewHTTPRequest().Plan(context.Background(), runCtx(), json.RawMessage(`{"url":"https://example.com"}`))
	assert.ErrorIs(t, err, scaffolder.ErrNoPlan)
}

func TestHTTPRequestExecuteSuccess(t *testing.T) {
	var gotMethod, gotHeader, gotBody string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotMethod = r.Method
		gotHeader = r.Header.Get("X-Orbit")
		b := make([]byte, r.ContentLength)
		if r.ContentLength > 0 {
			_, _ = r.Body.Read(b)
		}
		gotBody = string(b)
		w.Header().Set("X-Reply", "pong")
		w.WriteHeader(201)
		_, _ = w.Write([]byte(`{"ok":true}`))
	}))
	defer srv.Close()

	a := NewHTTPRequest(WithIPGuard(allowAll))
	out, err := execHTTP(t, a, fmt.Sprintf(`{"url":%q,"method":"post","headers":{"X-Orbit":"yes"},"body":"hi"}`, srv.URL))
	require.NoError(t, err)
	assert.Equal(t, 201, out.Status)
	assert.Equal(t, `{"ok":true}`, out.Body)
	assert.False(t, out.Truncated)
	assert.Equal(t, "pong", out.Headers["X-Reply"])
	assert.Equal(t, "POST", gotMethod, "method must be normalised to upper case")
	assert.Equal(t, "yes", gotHeader)
	assert.Equal(t, "hi", gotBody)
}

func TestHTTPRequestResponseSizeCap(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte(strings.Repeat("a", 5000)))
	}))
	defer srv.Close()

	a := NewHTTPRequest(WithIPGuard(allowAll))
	out, err := execHTTP(t, a, fmt.Sprintf(`{"url":%q,"maxResponseBytes":16}`, srv.URL))
	require.NoError(t, err)
	assert.True(t, out.Truncated)
	assert.Len(t, out.Body, 16)

	// The action-level cap wins over an oversized per-step request.
	a = NewHTTPRequest(WithIPGuard(allowAll), WithMaxResponseBytes(32))
	out, err = execHTTP(t, a, fmt.Sprintf(`{"url":%q,"maxResponseBytes":100000}`, srv.URL))
	require.NoError(t, err)
	assert.True(t, out.Truncated)
	assert.Len(t, out.Body, 32)
}

func TestHTTPRequestDoesNotFollowRedirects(t *testing.T) {
	target := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte("secret"))
	}))
	defer target.Close()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, target.URL, http.StatusFound)
	}))
	defer srv.Close()

	a := NewHTTPRequest(WithIPGuard(allowAll))
	_, err := execHTTP(t, a, fmt.Sprintf(`{"url":%q}`, srv.URL))
	require.Error(t, err)
	assert.Contains(t, err.Error(), "redirect")
}

func TestHTTPRequestBlocksLoopbackByDefault(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte("internal"))
	}))
	defer srv.Close()

	_, err := execHTTP(t, NewHTTPRequest(), fmt.Sprintf(`{"url":%q}`, srv.URL))
	require.Error(t, err)
	assert.Contains(t, err.Error(), "blocked")
}

func TestHTTPRequestBlocksDNSRebinding(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte("internal"))
	}))
	defer srv.Close()
	_, port, err := net.SplitHostPort(strings.TrimPrefix(srv.URL, "http://"))
	require.NoError(t, err)

	// A hostname that resolves to loopback must be refused even though the URL
	// itself looks external: the guard runs on the resolved address, and the
	// vetted address is what gets dialled.
	a := NewHTTPRequest(WithLookupIP(func(context.Context, string) ([]net.IP, error) {
		return []net.IP{net.ParseIP("127.0.0.1")}, nil
	}))
	_, err = execHTTP(t, a, fmt.Sprintf(`{"url":"http://totally-external.example.com:%s/"}`, port))
	require.Error(t, err)
	assert.Contains(t, err.Error(), "blocked")
}

func TestHTTPRequestBlocksMixedResolution(t *testing.T) {
	// One public and one internal answer: the whole request is refused rather
	// than racing to whichever the dialler prefers.
	a := NewHTTPRequest(WithLookupIP(func(context.Context, string) ([]net.IP, error) {
		return []net.IP{net.ParseIP("93.184.216.34"), net.ParseIP("169.254.169.254")}, nil
	}))
	_, err := execHTTP(t, a, `{"url":"http://mixed.example.com/"}`)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "blocked")
}

func TestHTTPRequestEmptyResolution(t *testing.T) {
	a := NewHTTPRequest(WithLookupIP(func(context.Context, string) ([]net.IP, error) {
		return nil, nil
	}))
	_, err := execHTTP(t, a, `{"url":"http://nowhere.example.com/"}`)
	require.Error(t, err)
}

func TestHTTPRequestTimeout(t *testing.T) {
	release := make(chan struct{})
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		<-release
	}))
	defer func() { close(release); srv.Close() }()

	a := NewHTTPRequest(WithIPGuard(allowAll))
	start := time.Now()
	_, err := execHTTP(t, a, fmt.Sprintf(`{"url":%q,"timeoutSeconds":1}`, srv.URL))
	require.Error(t, err)
	assert.Less(t, time.Since(start), 10*time.Second)
}

func TestHTTPRequestInputValidation(t *testing.T) {
	tests := []struct {
		name  string
		input string
		want  string
	}{
		{name: "missing url", input: `{}`, want: "url"},
		{name: "blank url", input: `{"url":"   "}`, want: "url"},
		{name: "file scheme", input: `{"url":"file:///etc/passwd"}`, want: "scheme"},
		{name: "ftp scheme", input: `{"url":"ftp://example.com/x"}`, want: "scheme"},
		{name: "gopher scheme", input: `{"url":"gopher://example.com"}`, want: "scheme"},
		{name: "no host", input: `{"url":"http:///path"}`, want: "host"},
		{name: "bad method", input: `{"url":"https://example.com","method":"TRACE"}`, want: "method"},
		{name: "connect method", input: `{"url":"https://example.com","method":"CONNECT"}`, want: "method"},
		{name: "negative timeout", input: `{"url":"https://example.com","timeoutSeconds":-1}`, want: "timeoutSeconds"},
		{name: "excessive timeout", input: `{"url":"https://example.com","timeoutSeconds":9999}`, want: "timeoutSeconds"},
		{name: "negative size cap", input: `{"url":"https://example.com","maxResponseBytes":-5}`, want: "maxResponseBytes"},
		{name: "malformed json", input: `{`, want: "decode"},
		{name: "unparsable url", input: `{"url":"http://a b c"}`, want: "url"},
	}
	a := NewHTTPRequest(WithIPGuard(allowAll))
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			_, err := a.Execute(context.Background(), runCtx(), json.RawMessage(tt.input))
			require.Error(t, err)
			assert.Contains(t, err.Error(), tt.want)
		})
	}
}

func TestDenyInternalIP(t *testing.T) {
	blocked := []string{
		"127.0.0.1", "127.1.2.3", "::1",
		"10.0.0.1", "10.255.255.255",
		"172.16.0.1", "172.31.255.255",
		"192.168.0.1", "192.168.255.255",
		"169.254.169.254", "169.254.0.1",
		"100.64.0.1", "100.127.255.255",
		"0.0.0.0", "0.1.2.3",
		"255.255.255.255", "224.0.0.1", "239.1.1.1",
		"192.0.0.1", "198.18.0.1", "198.19.255.255",
		"fd00::1", "fc00::1", "fe80::1", "ff02::1", "::",
		"::ffff:127.0.0.1", "::ffff:10.0.0.1", "::ffff:169.254.169.254",
		"64:ff9b::7f00:1",
	}
	allowed := []string{
		"8.8.8.8", "1.1.1.1", "93.184.216.34",
		"172.15.0.1", "172.32.0.1", "11.0.0.1", "100.63.255.255", "100.128.0.1",
		"2606:4700:4700::1111", "2001:4860:4860::8888",
	}
	for _, s := range blocked {
		t.Run("block/"+s, func(t *testing.T) {
			ip := net.ParseIP(s)
			require.NotNil(t, ip, "unparsable test IP")
			assert.Error(t, DenyInternalIP(ip))
		})
	}
	for _, s := range allowed {
		t.Run("allow/"+s, func(t *testing.T) {
			ip := net.ParseIP(s)
			require.NotNil(t, ip, "unparsable test IP")
			assert.NoError(t, DenyInternalIP(ip))
		})
	}
	assert.Error(t, DenyInternalIP(nil))
	assert.Error(t, DenyInternalIP(net.IP{1, 2}), "malformed address must be refused, not allowed")
}

func TestHTTPRequestIgnoresProxyEnvironment(t *testing.T) {
	// A proxy would route the request past the IP guard entirely.
	t.Setenv("HTTP_PROXY", "http://127.0.0.1:9")
	t.Setenv("HTTPS_PROXY", "http://127.0.0.1:9")
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte("direct"))
	}))
	defer srv.Close()

	out, err := execHTTP(t, NewHTTPRequest(WithIPGuard(allowAll)), fmt.Sprintf(`{"url":%q}`, srv.URL))
	require.NoError(t, err)
	assert.Equal(t, "direct", out.Body)
}
