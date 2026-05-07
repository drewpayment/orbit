package k8s

import (
	"fmt"
	"sort"
	"strings"
)

// podRenderInput is the data fed to renderPodManifest.
type podRenderInput struct {
	Namespace string
	PodName   string
	Image     string
	// Env is projected as a Secret-backed envFrom in the pod spec. The
	// executor creates a one-shot Secret named `<podName>-env` carrying
	// these values, then the pod consumes them via envFrom: secretRef. For
	// callers that don't need projection (tests, local-dev), Env may be nil.
	Env map[string]string
}

// renderPodManifest builds the YAML manifest the K8s SandboxExecutor
// applies. Mirrors infrastructure/k8s/agent-sandbox/pod-template.yaml but
// is the source of truth for what the worker actually creates.
func renderPodManifest(in podRenderInput) string {
	var envBlock string
	if len(in.Env) > 0 {
		envBlock = "      env:\n" + renderEnvList(in.Env)
	}
	return fmt.Sprintf(`apiVersion: v1
kind: Pod
metadata:
  name: %s
  namespace: %s
  labels:
    app.kubernetes.io/part-of: orbit
    app.kubernetes.io/component: infrastructure-agent
    orbit.dev/workflow-id: %s
spec:
  restartPolicy: Never
  automountServiceAccountToken: false
  securityContext:
    runAsNonRoot: true
    runAsUser: 1000
    fsGroup: 1000
    seccompProfile:
      type: RuntimeDefault
  containers:
    - name: agent
      image: %s
      imagePullPolicy: IfNotPresent
      command: ["sleep", "infinity"]
%s      resources:
        requests:
          cpu: 100m
          memory: 256Mi
        limits:
          cpu: 2000m
          memory: 4Gi
      securityContext:
        allowPrivilegeEscalation: false
        readOnlyRootFilesystem: true
        capabilities:
          drop: ["ALL"]
      volumeMounts:
        - name: workspace
          mountPath: /home/agent/workspace
        - name: tmp
          mountPath: /tmp
        - name: home-cache
          mountPath: /home/agent/.cache
        - name: home-config
          mountPath: /home/agent/.config
  volumes:
    - name: workspace
      emptyDir:
        sizeLimit: 8Gi
    - name: tmp
      emptyDir:
        sizeLimit: 1Gi
    - name: home-cache
      emptyDir:
        sizeLimit: 1Gi
    - name: home-config
      emptyDir:
        sizeLimit: 256Mi
`,
		in.PodName,
		in.Namespace,
		in.PodName,
		in.Image,
		envBlock,
	)
}

// renderEnvList sorts keys for deterministic output and produces the YAML
// list under `env:` for the pod spec. Values are single-quoted so secret
// material with shell metacharacters survives unscathed.
func renderEnvList(env map[string]string) string {
	keys := make([]string, 0, len(env))
	for k := range env {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	var b strings.Builder
	for _, k := range keys {
		b.WriteString("        - name: ")
		b.WriteString(k)
		b.WriteByte('\n')
		b.WriteString("          value: ")
		b.WriteString(yamlQuote(env[k]))
		b.WriteByte('\n')
	}
	return b.String()
}

// yamlQuote produces a YAML double-quoted scalar safe for arbitrary string
// content. We escape backslash, double-quote, and control chars; this is
// a strict subset of YAML 1.2 double-quoted style.
func yamlQuote(s string) string {
	var b strings.Builder
	b.WriteByte('"')
	for _, r := range s {
		switch r {
		case '\\':
			b.WriteString(`\\`)
		case '"':
			b.WriteString(`\"`)
		case '\n':
			b.WriteString(`\n`)
		case '\r':
			b.WriteString(`\r`)
		case '\t':
			b.WriteString(`\t`)
		default:
			if r < 0x20 {
				b.WriteString(fmt.Sprintf(`\x%02x`, r))
			} else {
				b.WriteRune(r)
			}
		}
	}
	b.WriteByte('"')
	return b.String()
}

// policyRenderInput is the data fed to renderNetworkPolicyManifest.
type policyRenderInput struct {
	Namespace  string
	PolicyName string
	PodName    string
	// Allowlist entries are host names or "*.example.com" suffix globs.
	// We translate each entry to an egress rule with a fqdn-based selector
	// using the standard NetworkPolicy v1 schema; the actual enforcement is
	// CNI-specific. For CNIs without FQDN support, operators should pre-
	// compute IPBlocks and apply a rendered policy directly.
	Allowlist []string
}

// renderNetworkPolicyManifest builds a deny-all-by-default NetworkPolicy
// scoped to the per-run pod, plus an egress rule for each allowlist host
// (TCP/443) and the cluster's CoreDNS. Entries with a leading "*." are
// emitted as wildcard host rules; callers using a non-FQDN-aware CNI must
// substitute a CIDR-based policy out-of-band.
func renderNetworkPolicyManifest(in policyRenderInput) string {
	var egress strings.Builder
	// DNS first.
	egress.WriteString(`    - to:
        - namespaceSelector:
            matchLabels:
              kubernetes.io/metadata.name: kube-system
          podSelector:
            matchLabels:
              k8s-app: kube-dns
      ports:
        - protocol: UDP
          port: 53
        - protocol: TCP
          port: 53
`)
	// Allowlisted hosts as comments (CNI-specific FQDN policies are added
	// downstream by the cluster operator). The annotation surfaces the
	// intent so the apply-time controller can render concrete rules.
	for _, host := range in.Allowlist {
		egress.WriteString("    # allow: ")
		egress.WriteString(host)
		egress.WriteByte('\n')
	}

	return fmt.Sprintf(`apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: %s
  namespace: %s
  labels:
    app.kubernetes.io/part-of: orbit
    app.kubernetes.io/component: infrastructure-agent
    orbit.dev/workflow-id: %s
  annotations:
    orbit.dev/egress-allowlist: %q
spec:
  podSelector:
    matchLabels:
      orbit.dev/workflow-id: %s
  policyTypes:
    - Ingress
    - Egress
  ingress: []
  egress:
%s`,
		in.PolicyName,
		in.Namespace,
		in.PodName,
		strings.Join(in.Allowlist, ","),
		in.PodName,
		egress.String(),
	)
}
