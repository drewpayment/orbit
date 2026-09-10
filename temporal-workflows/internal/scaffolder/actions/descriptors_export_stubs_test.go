package actions_test

import (
	"context"
	"errors"

	"github.com/drewpayment/orbit/temporal-workflows/internal/activities"
	"github.com/drewpayment/orbit/temporal-workflows/internal/services"
)

// stubTokenService, stubCatalogClient, stubKafkaTopicClient and
// stubKafkaProvisioner exist only so DefaultActions returns its full set in
// TestDescriptorActions_CoversEveryDefaultAction. None is ever called.
type stubTokenService struct{}

func (stubTokenService) GetInstallationToken(context.Context, string) (string, error) {
	return "", errors.New("stub")
}

type stubCatalogClient struct{}

func (stubCatalogClient) RegisterEntity(context.Context, services.CatalogEntityRegisterInput) (*services.CatalogEntityRegisterResult, error) {
	return nil, errors.New("stub")
}

type stubKafkaTopicClient struct{}

func (stubKafkaTopicClient) CreateTopic(context.Context, services.KafkaTopicCreateInput) (services.KafkaTopicDoc, error) {
	return services.KafkaTopicDoc{}, errors.New("stub")
}

type stubKafkaProvisioner struct{}

func (stubKafkaProvisioner) ProvisionTopic(context.Context, activities.KafkaTopicProvisionInput) (*activities.KafkaTopicProvisionOutput, error) {
	return nil, errors.New("stub")
}

func (stubKafkaProvisioner) UpdateTopicStatus(context.Context, activities.KafkaUpdateTopicStatusInput) error {
	return errors.New("stub")
}

type stubSkeletonClient struct{}

func (stubSkeletonClient) GetSkeletonManifest(context.Context, string, string) (*services.SkeletonBundle, error) {
	return nil, errors.New("stub")
}

func (stubSkeletonClient) GetSkeletonBundle(context.Context, string, string) (*services.SkeletonBundle, error) {
	return nil, errors.New("stub")
}
