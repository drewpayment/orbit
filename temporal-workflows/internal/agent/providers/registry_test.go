package providers

import (
	"context"
	"errors"
	"testing"
)

type stubProvider struct{ name string }

func (s *stubProvider) Name() string { return s.name }
func (s *stubProvider) StreamComplete(_ context.Context, _ CompletionRequest, _ func(Delta) error) (Response, error) {
	return Response{Text: "stub"}, nil
}

func TestRegisterAndBuild(t *testing.T) {
	Register("test-stub", func(cfg Config) (Provider, error) {
		return &stubProvider{name: "test-stub"}, nil
	})

	p, err := Build("test-stub", Config{})
	if err != nil {
		t.Fatal(err)
	}
	if p.Name() != "test-stub" {
		t.Errorf("name = %q, want test-stub", p.Name())
	}
}

func TestBuild_UnknownProvider(t *testing.T) {
	_, err := Build("does-not-exist", Config{})
	if err == nil {
		t.Fatal("expected error for unknown provider")
	}
}

func TestRegisterOverridesPriorFactory(t *testing.T) {
	Register("override-test", func(cfg Config) (Provider, error) {
		return &stubProvider{name: "v1"}, nil
	})
	Register("override-test", func(cfg Config) (Provider, error) {
		return &stubProvider{name: "v2"}, nil
	})
	p, _ := Build("override-test", Config{})
	if p.Name() != "v2" {
		t.Errorf("expected v2 to win")
	}
}

func TestFactoryError(t *testing.T) {
	wantErr := errors.New("nope")
	Register("err-test", func(cfg Config) (Provider, error) {
		return nil, wantErr
	})
	_, err := Build("err-test", Config{})
	if !errors.Is(err, wantErr) {
		t.Errorf("err = %v, want %v", err, wantErr)
	}
}
