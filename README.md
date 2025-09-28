# Orbit (IDP)

A comprehensive multi-tenant SaaS platform designed to accelerate developer productivity by providing centralized repository management, API schema cataloging, and collaborative knowledge sharing across development teams.

## 🚀 Overview

Orbit serves as the single source of truth for development teams, enabling them to:

- **Create repositories from templates** with automated configuration and best practices
- **Manage API schemas** with automatic client library generation across multiple languages
- **Maintain collaborative documentation** with real-time editing and team-based access control
- **Discover services and dependencies** through a centralized catalog with visual dependency mapping

## ✨ Key Features

### 🏗️ Repository Management
- **Template-based Repository Creation**: Generate new services, libraries, and applications from pre-approved organizational templates
- **Git Integration**: Seamless integration with GitHub, GitLab, and other Git providers
- **Dependency Tracking**: Visual dependency graphs and impact analysis across services
- **Automated Configuration**: Generate Kubernetes manifests, CI/CD pipelines, and infrastructure configuration

### 📋 API Schema Catalog
- **Multi-format Support**: OpenAPI, GraphQL, Protocol Buffers, and Avro schema management
- **Code Generation**: Automatic client library generation in TypeScript, Go, Python, Java, and more
- **Version Management**: Schema versioning with breaking change detection and compatibility analysis
- **Consumer Tracking**: Monitor API usage and notify consumers of schema changes

### 📚 Knowledge Management
- **Collaborative Documentation**: Real-time collaborative editing with rich text and Markdown support
- **Hierarchical Organization**: Nested knowledge spaces for logical information architecture
- **Full-text Search**: Fast, relevant search across all documentation and API schemas
- **Access Control**: Fine-grained permissions per workspace and knowledge space

### ⚡ Workflow Orchestration
- **Long-running Operations**: Durable workflow execution for complex multi-step processes like code generation
- **Progress Tracking**: Real-time progress updates for repository creation and code generation
- **Retry and Error Handling**: Built-in reliability with automatic retry mechanisms
- **Scheduled Tasks**: Automated backups, synchronization, and maintenance operations

## 🏛️ Architecture

### Multi-Service Architecture
```
Frontend (Payload 3.0 + NextJS 15)
├── Content Management System
├── User Interface & Public Pages  
└── Temporal Workflow Management

Backend Services (Go)
├── Repository Service
├── API Catalog Service  
├── Knowledge Service
└── Temporal Workflow Service

Data Layer
├── PostgreSQL (Primary Database)
├── SQLite (Payload Development)
├── Redis (Caching & Sessions)
├── MeiliSearch (Full-text Search)
└── MinIO/S3 (Object Storage)
```

### Technology Stack

**Frontend**
- Payload 3.0 with NextJS 15 for content management and server-side rendering
- TypeScript throughout for type safety and developer experience
- SQLite for development, PostgreSQL for production

**Backend**
- Go 1.21+ microservices for high performance and Kubernetes-native deployment
- Protocol Buffers (gRPC) for type-safe inter-service communication
- Temporal for workflow orchestration and durable execution

**Data & Infrastructure**
- PostgreSQL 15+ with multi-tenant architecture and JSON support
- Redis for caching, sessions, and real-time features
- MeiliSearch for fast, relevant full-text search
- Docker containerization with Kubernetes deployment

## 🎯 Use Cases

### Platform Teams
- Standardize service creation across the organization
- Enforce architectural patterns and best practices
- Provide self-service infrastructure provisioning
- Maintain centralized documentation and runbooks

### Development Teams
- Quickly bootstrap new services from proven templates
- Generate and consume API clients automatically
- Discover existing services and avoid reinventing solutions
- Collaborate on technical documentation and specifications

### API Governance
- Maintain an organization-wide API catalog
- Track API consumers and usage patterns
- Enforce schema validation and breaking change policies
- Generate comprehensive API documentation automatically

## 🔧 Core Workflows

### Service Creation Workflow
1. **Template Selection**: Choose from organization-approved service templates
2. **Configuration**: Customize variables like database type, authentication method, and deployment target
3. **Repository Generation**: Automated creation of Git repository with proper structure and configuration
4. **CI/CD Setup**: Automatic generation of build pipelines and deployment manifests
5. **Documentation**: Auto-generated README, API docs, and deployment guides

### API Development Lifecycle
1. **Schema Definition**: Create or upload API schemas (OpenAPI, protobuf, etc.)
2. **Validation**: Automated schema validation and breaking change detection
3. **Code Generation**: Generate client libraries in multiple programming languages
4. **Publishing**: Publish schemas to the organization-wide API catalog
5. **Consumption Tracking**: Monitor which services consume each API

### Knowledge Collaboration
1. **Space Creation**: Set up team-specific documentation spaces
2. **Content Creation**: Collaborative editing with live preview and auto-save
3. **Review Process**: Comment and approval workflows for documentation quality
4. **Discovery**: Full-text search across all organizational knowledge
5. **Access Management**: Role-based permissions and visibility controls

## 🚦 Getting Started

### Prerequisites
- Docker and Docker Compose
- Node.js 18+ and Go 1.21+
- PostgreSQL 15+ (or use Docker Compose)

### Quick Start
```bash
# Clone the repository
git clone <repository-url>
cd idp

# Start all services
docker-compose up -d

# Initialize the database
make db-migrate

# Start the Payload development server
cd orbit-www && pnpm dev

# Access the application
open http://localhost:3000
```

### First Steps
1. Create your first workspace
2. Import existing repositories or create new ones from templates
3. Upload API schemas to begin cataloging your services
4. Set up knowledge spaces for team documentation

## 📊 Performance & Scale

### Performance Targets
- **API Response Time**: <200ms for 95th percentile requests
- **Code Generation**: <30 seconds for large schemas
- **Repository Sync**: <2 minutes for 10,000 files
- **Search Results**: <1 second for typical queries

### Scalability
- **Concurrent Users**: 500 per workspace
- **Multi-tenant Architecture**: Workspace-level isolation with shared infrastructure
- **Horizontal Scaling**: Stateless services with Kubernetes orchestration
- **Caching Strategy**: Multi-layer caching with Redis for optimal performance

## 🔒 Security & Compliance

### Authentication & Authorization
- OAuth 2.0 integration with GitHub, Google, Azure AD
- Role-based access control (RBAC) at workspace and resource levels
- JWT tokens with refresh mechanism for secure API access

### Data Protection
- TLS 1.3 encryption for all communications
- AES-256 encryption for data at rest
- Audit logging for all user activities
- SOC 2 Type II compliance readiness

### Multi-Tenancy
- Workspace-level data isolation
- Row-level security policies
- Encrypted secrets management
- Compliance with GDPR and other privacy regulations

## 🛠️ Development

### Project Structure
```
orbit-www/          # Payload 3.0 application with integrated NextJS
services/           # Go microservices
  ├── repository/   # Repository management service
  ├── api-catalog/  # API schema catalog service
  ├── knowledge/    # Knowledge management service
  └── temporal-workflows/  # Temporal workflow service
proto/              # Protocol buffer definitions
infrastructure/     # Docker, Kubernetes, Terraform
specs/              # Feature specifications and documentation
```

### Contributing
1. Fork the repository
2. Create a feature branch
3. Follow the coding standards and run tests
4. Submit a pull request with detailed description

### Testing Strategy
- **Unit Tests**: 90% coverage for business logic
- **Integration Tests**: API contract validation
- **End-to-End Tests**: Critical user journey validation
- **Performance Tests**: Load testing with Artillery

## 📈 Roadmap

### Phase 1: Foundation (Current)
- ✅ Multi-tenant workspace management
- ✅ Repository template system
- ✅ Basic API schema catalog
- ✅ Knowledge space collaboration

### Phase 2: Enhancement
- 🔄 Advanced code generation with custom templates
- 🔄 Visual dependency mapping
- 🔄 Integration with external CI/CD systems
- 🔄 Advanced search with filters and facets

### Phase 3: Advanced Features
- 📅 Service mesh integration
- 📅 Cost analysis and optimization recommendations
- 📅 Advanced analytics and insights
- 📅 Plugin system for extensibility

### Phase 4: Enterprise
- 📅 Advanced compliance and governance
- 📅 Multi-region deployment
- 📅 Enterprise SSO and audit integration
- 📅 Custom workflow orchestration

## 🤝 Community & Support

### Getting Help
- 📖 [Documentation](./docs/) - Comprehensive guides and API references
- 💬 [Discussions](./discussions/) - Community questions and feature requests
- 🐛 [Issues](./issues/) - Bug reports and feature requests
- 📧 [Email Support](mailto:support@company.com) - Direct support channel

### Contributing
We welcome contributions from the community! Please see our [Contributing Guide](./CONTRIBUTING.md) for details on:
- Code of Conduct
- Development setup
- Coding standards
- Pull request process
- Issue reporting

## 📄 License

## License
   This project is licensed under the Elastic License 2.0 - see the [LICENSE](./LICENSE) file for details.

---

**Built with ❤️ for developers, by developers**

*Orbit empowers teams to focus on building great products by eliminating the friction in service creation, API management, and knowledge sharing.*