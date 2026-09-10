package actions_test

import (
	"context"
	"errors"

	"github.com/drewpayment/orbit/temporal-workflows/internal/services"
)

// stubTokenService, stubCatalogClient, stubApiSchemaClient and
// stubSkeletonClient exist only so DefaultActions returns its full set in
// TestDescriptorActions_CoversEveryDefaultAction. None is ever called.
type stubTokenService struct{}

func (stubTokenService) GetInstallationToken(context.Context, string) (string, error) {
	return "", errors.New("stub")
}

type stubCatalogClient struct{}

func (stubCatalogClient) RegisterEntity(context.Context, services.CatalogEntityRegisterInput) (*services.CatalogEntityRegisterResult, error) {
	return nil, errors.New("stub")
}

type stubApiSchemaClient struct{}

func (stubApiSchemaClient) RegisterSchema(context.Context, services.ApiSchemaRegisterInput) (*services.ApiSchemaRegisterResult, error) {
	return nil, errors.New("stub")
}

type stubSkeletonClient struct{}

func (stubSkeletonClient) GetSkeletonManifest(context.Context, string, string) (*services.SkeletonBundle, error) {
	return nil, errors.New("stub")
}

func (stubSkeletonClient) GetSkeletonBundle(context.Context, string, string) (*services.SkeletonBundle, error) {
	return nil, errors.New("stub")
}
