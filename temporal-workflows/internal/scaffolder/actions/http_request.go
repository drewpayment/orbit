package actions

import (
	"context"
	_ "embed"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"sort"
	"strings"
	"time"

	"github.com/drewpayment/orbit/temporal-workflows/internal/scaffolder"
)

//go:embed http_request.input.schema.json
var httpRequestInputSchema []byte

//go:embed http_request.output.schema.json
var httpRequestOutputSchema []byte

const (
	httpDefaultTimeout  = 30 * time.Second
	httpMaxTimeout      = 120 * time.Second
	httpDefaultMaxBytes = int64(1 << 20)  // 1 MiB
	httpHardMaxBytes    = int64(10 << 20) // 10 MiB
	httpDialTimeout     = 10 * time.Second
)

// IPGuard decides whether a resolved address may be dialled. Returning an error
// refuses the connection.
type IPGuard func(net.IP) error

// LookupIPFunc resolves a hostname. Overridable so the SSRF guard can be tested
// without a real resolver.
type LookupIPFunc func(ctx context.Context, host string) ([]net.IP, error)

// HTTPRequest performs a bounded outbound HTTP call: fixed timeout, capped
// response body, no redirects, no proxy, and an SSRF guard applied to the
// resolved address.
//
// Templates can be `visibility: public` and are authored by people who are not
// necessarily on the platform team, so this action treats its URL as hostile
// input. It resolves the hostname itself, refuses the request if ANY answer is
// an internal address, and then dials the vetted IP literal — so a DNS rebind
// between the check and the dial has nothing to rebind.
//
// Plan is unsupported: an outbound call is not a describable change.
type HTTPRequest struct {
	guard    IPGuard
	lookupIP LookupIPFunc
	maxBytes int64
}

// HTTPRequestOption configures the action at worker-wiring time.
type HTTPRequestOption func(*HTTPRequest)

// WithIPGuard replaces the default address policy. Intended for tests and for
// self-hosted deployments that must reach a specific internal host.
func WithIPGuard(g IPGuard) HTTPRequestOption {
	return func(a *HTTPRequest) {
		if g != nil {
			a.guard = g
		}
	}
}

// WithLookupIP replaces the resolver. Intended for tests.
func WithLookupIP(f LookupIPFunc) HTTPRequestOption {
	return func(a *HTTPRequest) {
		if f != nil {
			a.lookupIP = f
		}
	}
}

// WithMaxResponseBytes lowers the ceiling a step may request.
func WithMaxResponseBytes(n int64) HTTPRequestOption {
	return func(a *HTTPRequest) {
		if n > 0 {
			a.maxBytes = n
		}
	}
}

// NewHTTPRequest constructs the http:request action.
func NewHTTPRequest(opts ...HTTPRequestOption) *HTTPRequest {
	a := &HTTPRequest{guard: DenyInternalIP, lookupIP: defaultLookupIP, maxBytes: httpHardMaxBytes}
	for _, o := range opts {
		o(a)
	}
	return a
}

// Name implements scaffolder.Action.
func (a *HTTPRequest) Name() string { return "http:request" }

// InputSchema implements scaffolder.Action.
func (a *HTTPRequest) InputSchema() json.RawMessage { return httpRequestInputSchema }

// OutputSchema implements scaffolder.Action.
func (a *HTTPRequest) OutputSchema() json.RawMessage { return httpRequestOutputSchema }

// SupportsPlan implements scaffolder.PlanDeclarer.
func (a *HTTPRequest) SupportsPlan() bool { return false }

// Plan implements scaffolder.Action; outbound calls cannot be dry-run.
func (a *HTTPRequest) Plan(context.Context, scaffolder.ActionRunContext, json.RawMessage) ([]scaffolder.PlannedChange, error) {
	return nil, scaffolder.ErrNoPlan
}

type httpRequestInput struct {
	URL              string            `json:"url"`
	Method           string            `json:"method"`
	Headers          map[string]string `json:"headers"`
	Body             string            `json:"body"`
	TimeoutSeconds   int               `json:"timeoutSeconds"`
	MaxResponseBytes int64             `json:"maxResponseBytes"`
}

var httpAllowedMethods = map[string]bool{
	http.MethodGet: true, http.MethodHead: true, http.MethodPost: true,
	http.MethodPut: true, http.MethodPatch: true, http.MethodDelete: true,
}

// Execute performs the request and returns status, headers and a capped body.
func (a *HTTPRequest) Execute(ctx context.Context, rc scaffolder.ActionRunContext, input json.RawMessage) (json.RawMessage, error) {
	in, target, err := a.parseInput(input)
	if err != nil {
		return nil, err
	}

	timeout := httpDefaultTimeout
	if in.TimeoutSeconds > 0 {
		timeout = time.Duration(in.TimeoutSeconds) * time.Second
	}
	maxBytes := httpDefaultMaxBytes
	if in.MaxResponseBytes > 0 {
		maxBytes = in.MaxResponseBytes
	}
	if maxBytes > a.maxBytes {
		maxBytes = a.maxBytes
	}

	req, err := http.NewRequestWithContext(ctx, in.Method, target.String(), strings.NewReader(in.Body))
	if err != nil {
		return nil, fmt.Errorf("http:request: build request: %w", err)
	}
	for _, k := range sortedStringKeys(in.Headers) {
		req.Header.Set(k, in.Headers[k])
	}

	client := &http.Client{
		Timeout: timeout,
		// Redirects are refused rather than followed: a 302 to an internal
		// address is the classic way around a URL-level SSRF check.
		CheckRedirect: func(r *http.Request, _ []*http.Request) error {
			return fmt.Errorf("refusing to follow redirect to %q", r.URL.Redacted())
		},
		Transport: &http.Transport{
			// Proxy: nil on purpose. A proxy from the environment would carry
			// the request past the address guard.
			Proxy:                  nil,
			DialContext:            a.dialContext,
			ForceAttemptHTTP2:      true,
			TLSHandshakeTimeout:    httpDialTimeout,
			ResponseHeaderTimeout:  timeout,
			MaxResponseHeaderBytes: 1 << 20,
			DisableKeepAlives:      true,
		},
	}

	rc.Heartbeat("http:request", in.Method, target.Redacted())
	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("http:request: %w", err)
	}
	defer func() { _ = resp.Body.Close() }()

	body, err := io.ReadAll(io.LimitReader(resp.Body, maxBytes+1))
	if err != nil {
		return nil, fmt.Errorf("http:request: read response: %w", err)
	}
	truncated := int64(len(body)) > maxBytes
	if truncated {
		body = body[:maxBytes]
	}

	headers := make(map[string]string, len(resp.Header))
	for k, v := range resp.Header {
		headers[k] = strings.Join(v, ", ")
	}

	return json.Marshal(map[string]any{
		"status":    resp.StatusCode,
		"headers":   headers,
		"body":      string(body),
		"truncated": truncated,
	})
}

func (a *HTTPRequest) parseInput(raw json.RawMessage) (httpRequestInput, *url.URL, error) {
	var in httpRequestInput
	if len(strings.TrimSpace(string(raw))) > 0 {
		if err := json.Unmarshal(raw, &in); err != nil {
			return in, nil, fmt.Errorf("http:request: decode input: %w", err)
		}
	}
	if strings.TrimSpace(in.URL) == "" {
		return in, nil, fmt.Errorf("http:request: `url` is required")
	}
	target, err := url.Parse(strings.TrimSpace(in.URL))
	if err != nil {
		return in, nil, fmt.Errorf("http:request: `url` is not parsable: %w", err)
	}
	switch target.Scheme {
	case "http", "https":
	default:
		return in, nil, fmt.Errorf("http:request: unsupported `url` scheme %q, expected http or https", target.Scheme)
	}
	if target.Hostname() == "" {
		return in, nil, fmt.Errorf("http:request: `url` has no host")
	}
	if in.Method == "" {
		in.Method = http.MethodGet
	}
	in.Method = strings.ToUpper(strings.TrimSpace(in.Method))
	if !httpAllowedMethods[in.Method] {
		return in, nil, fmt.Errorf("http:request: unsupported `method` %q", in.Method)
	}
	if in.TimeoutSeconds < 0 || time.Duration(in.TimeoutSeconds)*time.Second > httpMaxTimeout {
		return in, nil, fmt.Errorf("http:request: `timeoutSeconds` must be between 1 and %d", int(httpMaxTimeout.Seconds()))
	}
	if in.MaxResponseBytes < 0 || in.MaxResponseBytes > httpHardMaxBytes {
		return in, nil, fmt.Errorf("http:request: `maxResponseBytes` must be between 1 and %d", httpHardMaxBytes)
	}
	return in, target, nil
}

// dialContext resolves the host, refuses the connection if any answer is an
// internal address, and dials the vetted IP literal.
func (a *HTTPRequest) dialContext(ctx context.Context, network, addr string) (net.Conn, error) {
	host, port, err := net.SplitHostPort(addr)
	if err != nil {
		return nil, fmt.Errorf("invalid address %q: %w", addr, err)
	}
	ips, err := a.lookupIP(ctx, host)
	if err != nil {
		return nil, fmt.Errorf("resolve %q: %w", host, err)
	}
	if len(ips) == 0 {
		return nil, fmt.Errorf("resolve %q: no addresses returned", host)
	}
	// Every answer must pass. Allowing the request when only some answers are
	// public would let an attacker win by retry.
	for _, ip := range ips {
		if err := a.guard(ip); err != nil {
			return nil, fmt.Errorf("blocked: %q resolves to %s: %w", host, ip, err)
		}
	}
	d := &net.Dialer{Timeout: httpDialTimeout}
	var lastErr error
	for _, ip := range ips {
		conn, err := d.DialContext(ctx, network, net.JoinHostPort(ip.String(), port))
		if err == nil {
			return conn, nil
		}
		lastErr = err
	}
	return nil, lastErr
}

func defaultLookupIP(ctx context.Context, host string) ([]net.IP, error) {
	if ip := net.ParseIP(host); ip != nil {
		return []net.IP{ip}, nil
	}
	return net.DefaultResolver.LookupIP(ctx, "ip", host)
}

// internalCIDRs are the ranges an Orbit worker must never be talked into
// reaching on a template author's behalf.
var internalCIDRs = func() []*net.IPNet {
	blocks := []string{
		"0.0.0.0/8",      // "this network"
		"10.0.0.0/8",     // private
		"100.64.0.0/10",  // carrier-grade NAT
		"127.0.0.0/8",    // loopback
		"169.254.0.0/16", // link-local, includes 169.254.169.254 metadata
		"172.16.0.0/12",  // private
		"192.0.0.0/24",   // IETF protocol assignments
		"192.168.0.0/16", // private
		"198.18.0.0/15",  // benchmarking
		"224.0.0.0/4",    // multicast
		"240.0.0.0/4",    // reserved, includes 255.255.255.255
		"::/128",         // unspecified
		"::1/128",        // loopback
		"fc00::/7",       // unique local
		"fe80::/10",      // link-local
		"ff00::/8",       // multicast
		"2001:db8::/32",  // documentation
	}
	out := make([]*net.IPNet, 0, len(blocks))
	for _, b := range blocks {
		_, n, err := net.ParseCIDR(b)
		if err != nil {
			panic("scaffolder/actions: bad internal CIDR " + b)
		}
		out = append(out, n)
	}
	return out
}()

// nat64Prefix is the well-known NAT64 prefix; its low 32 bits carry an IPv4
// address, so 64:ff9b::7f00:1 reaches 127.0.0.1.
var nat64Prefix = func() *net.IPNet {
	_, n, _ := net.ParseCIDR("64:ff9b::/96")
	return n
}()

// DenyInternalIP is the default IPGuard: it refuses loopback, private,
// link-local, CGNAT, multicast and reserved addresses, in both IPv4 and IPv6,
// including IPv4-mapped and NAT64-embedded forms.
func DenyInternalIP(ip net.IP) error {
	if ip == nil || (len(ip) != net.IPv4len && len(ip) != net.IPv6len) {
		return fmt.Errorf("address is not a valid IP")
	}
	// Unwrap ::ffff:a.b.c.d so a mapped private address is judged as IPv4.
	if v4 := ip.To4(); v4 != nil {
		ip = v4
	} else if nat64Prefix.Contains(ip) {
		if err := DenyInternalIP(net.IPv4(ip[12], ip[13], ip[14], ip[15])); err != nil {
			return fmt.Errorf("NAT64-embedded %w", err)
		}
	}
	if !ip.IsGlobalUnicast() || ip.IsPrivate() || ip.IsLoopback() || ip.IsLinkLocalUnicast() || ip.IsLinkLocalMulticast() {
		return fmt.Errorf("address %s is not a public unicast address", ip)
	}
	for _, n := range internalCIDRs {
		if n.Contains(ip) {
			return fmt.Errorf("address %s is inside reserved range %s", ip, n)
		}
	}
	return nil
}

func sortedStringKeys(m map[string]string) []string {
	out := make([]string, 0, len(m))
	for k := range m {
		out = append(out, k)
	}
	sort.Strings(out)
	return out
}
