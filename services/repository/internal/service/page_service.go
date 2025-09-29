/**
 * T040 - Service Layer: PageService with Rendering and Templating
 *
 * This service implements business logic for page operations including
 * page management, template rendering, dynamic content generation,
 * SEO optimization, and integration with knowledge and repository systems.
 *
 * Constitutional Requirements:
 * - Dynamic page rendering with template engine
 * - Multi-format content support (HTML, Markdown, MDX)
 * - SEO optimization and meta management
 * - Template inheritance and component system
 * - Multi-tenant workspace isolation
 * - Performance optimization with caching
 */

package service

import (
	"context"
	"fmt"
	"log/slog"
	"regexp"
	"time"

	"github.com/drewpayment/orbit/services/repository/internal/domain"
	"github.com/google/uuid"
)

// PageRepository defines the repository interface for page operations
type PageRepository interface {
	// Basic CRUD operations
	Create(ctx context.Context, page *domain.Page) error
	Update(ctx context.Context, page *domain.Page) error
	Delete(ctx context.Context, id uuid.UUID) error
	GetByID(ctx context.Context, id uuid.UUID) (*domain.Page, error)
	GetBySlug(ctx context.Context, workspaceID uuid.UUID, slug string) (*domain.Page, error)
	GetByPath(ctx context.Context, workspaceID uuid.UUID, path string) (*domain.Page, error)

	// Template operations
	CreateTemplate(ctx context.Context, template *domain.PageTemplate) error
	UpdateTemplate(ctx context.Context, template *domain.PageTemplate) error
	DeleteTemplate(ctx context.Context, id uuid.UUID) error
	GetTemplateByID(ctx context.Context, id uuid.UUID) (*domain.PageTemplate, error)
	GetTemplateByName(ctx context.Context, workspaceID uuid.UUID, name string) (*domain.PageTemplate, error)

	// Listing and search
	ListPagesByWorkspace(ctx context.Context, workspaceID uuid.UUID, filters PageFilters) ([]*domain.Page, error)
	ListTemplatesByWorkspace(ctx context.Context, workspaceID uuid.UUID, filters PageTemplateFilters) ([]*domain.PageTemplate, error)
	SearchPages(ctx context.Context, workspaceID uuid.UUID, query string, filters PageFilters) ([]*domain.Page, error)

	// Statistics and analytics
	GetPageStats(ctx context.Context, pageID uuid.UUID) (*PageStats, error)
	GetWorkspacePageStats(ctx context.Context, workspaceID uuid.UUID) (*WorkspacePageStats, error)
	RecordPageView(ctx context.Context, pageID, userID uuid.UUID, metadata map[string]interface{}) error
}

// TemplateEngine defines the interface for template rendering operations
type TemplateEngine interface {
	RenderTemplate(ctx context.Context, req *RenderRequest) (*RenderResult, error)
	CompileTemplate(ctx context.Context, template string, format TemplateFormat) (*CompiledTemplate, error)
	ValidateTemplate(ctx context.Context, template string, format TemplateFormat) (*ValidationResult, error)
	RegisterHelper(name string, helper TemplateHelper) error
	RegisterPartial(name string, template string) error
	ClearCache(ctx context.Context, templateID uuid.UUID) error
}

// SEOOptimizer defines the interface for SEO optimization
type SEOOptimizer interface {
	OptimizePage(ctx context.Context, req *SEOOptimizationRequest) (*SEOOptimizationResult, error)
	GenerateMetaTags(ctx context.Context, page *domain.Page) (*MetaTags, error)
	GenerateStructuredData(ctx context.Context, page *domain.Page) (*StructuredData, error)
	AnalyzeSEO(ctx context.Context, content string, metadata map[string]interface{}) (*SEOAnalysis, error)
	GenerateSitemap(ctx context.Context, workspaceID uuid.UUID) (*Sitemap, error)
}

// AssetManager defines the interface for asset management
type AssetManager interface {
	UploadAsset(ctx context.Context, req *AssetUploadRequest) (*Asset, error)
	GetAsset(ctx context.Context, id uuid.UUID) (*Asset, error)
	DeleteAsset(ctx context.Context, id uuid.UUID) error
	ListAssets(ctx context.Context, workspaceID uuid.UUID, filters AssetFilters) ([]*Asset, error)
	OptimizeImage(ctx context.Context, assetID uuid.UUID, options ImageOptimizationOptions) (*Asset, error)
	GenerateThumbnail(ctx context.Context, assetID uuid.UUID, size ThumbnailSize) (*Asset, error)
}

// PageFormat represents supported page formats
type PageFormat string

const (
	PageFormatHTML     PageFormat = "html"
	PageFormatMarkdown PageFormat = "markdown"
	PageFormatMDX      PageFormat = "mdx"
	PageFormatJSON     PageFormat = "json"
	PageFormatYAML     PageFormat = "yaml"
)

// TemplateFormat represents template formats
type TemplateFormat string

const (
	TemplateFormatHandlebars TemplateFormat = "handlebars"
	TemplateFormatMustache   TemplateFormat = "mustache"
	TemplateFormatGo         TemplateFormat = "go"
	TemplateFormatLiquid     TemplateFormat = "liquid"
)

// PageStatus represents the status of a page
type PageStatus string

const (
	PageStatusDraft     PageStatus = "draft"
	PageStatusPublished PageStatus = "published"
	PageStatusArchived  PageStatus = "archived"
	PageStatusDeleted   PageStatus = "deleted"
)

// PageType represents the type of a page
type PageType string

const (
	PageTypeStatic   PageType = "static"
	PageTypeDynamic  PageType = "dynamic"
	PageTypeLanding  PageType = "landing"
	PageTypeTemplate PageType = "template"
	PageTypeAPI      PageType = "api"
)

// TemplateType represents template types
type TemplateType string

const (
	TemplateTypeLayout    TemplateType = "layout"
	TemplateTypePage      TemplateType = "page"
	TemplateTypePartial   TemplateType = "partial"
	TemplateTypeComponent TemplateType = "component"
	TemplateTypeEmail     TemplateType = "email"
)

// AssetType represents asset types
type AssetType string

const (
	AssetTypeImage    AssetType = "image"
	AssetTypeVideo    AssetType = "video"
	AssetTypeDocument AssetType = "document"
	AssetTypeFont     AssetType = "font"
	AssetTypeCSS      AssetType = "css"
	AssetTypeJS       AssetType = "javascript"
	AssetTypeOther    AssetType = "other"
)

// PageFilters contains filtering options for page queries
type PageFilters struct {
	Status        []PageStatus `json:"status"`
	Type          []PageType   `json:"type"`
	Format        []PageFormat `json:"format"`
	TemplateID    *uuid.UUID   `json:"template_id"`
	CreatedBy     *uuid.UUID   `json:"created_by"`
	UpdatedBy     *uuid.UUID   `json:"updated_by"`
	CreatedAfter  *time.Time   `json:"created_after"`
	CreatedBefore *time.Time   `json:"created_before"`
	HasMetadata   *bool        `json:"has_metadata"`
	Tags          []string     `json:"tags"`
	Limit         int          `json:"limit"`
	Offset        int          `json:"offset"`
	SortBy        string       `json:"sort_by"`    // title, created_at, updated_at, view_count
	SortOrder     string       `json:"sort_order"` // asc, desc
}

// PageTemplateFilters contains filtering options for template queries
type PageTemplateFilters struct {
	Type          []TemplateType   `json:"type"`
	Format        []TemplateFormat `json:"format"`
	CreatedBy     *uuid.UUID       `json:"created_by"`
	UpdatedBy     *uuid.UUID       `json:"updated_by"`
	CreatedAfter  *time.Time       `json:"created_after"`
	CreatedBefore *time.Time       `json:"created_before"`
	IsActive      *bool            `json:"is_active"`
	Tags          []string         `json:"tags"`
	Limit         int              `json:"limit"`
	Offset        int              `json:"offset"`
	SortBy        string           `json:"sort_by"`    // name, created_at, updated_at, usage_count
	SortOrder     string           `json:"sort_order"` // asc, desc
}

// AssetFilters contains filtering options for asset queries
type AssetFilters struct {
	Type           []AssetType `json:"type"`
	MimeTypes      []string    `json:"mime_types"`
	MinSize        *int64      `json:"min_size"`
	MaxSize        *int64      `json:"max_size"`
	UploadedBy     *uuid.UUID  `json:"uploaded_by"`
	UploadedAfter  *time.Time  `json:"uploaded_after"`
	UploadedBefore *time.Time  `json:"uploaded_before"`
	Tags           []string    `json:"tags"`
	Limit          int         `json:"limit"`
	Offset         int         `json:"offset"`
	SortBy         string      `json:"sort_by"`    // name, size, created_at, usage_count
	SortOrder      string      `json:"sort_order"` // asc, desc
}

// CreatePageRequest contains data for creating a page
type CreatePageRequest struct {
	WorkspaceID uuid.UUID              `json:"workspace_id" validate:"required"`
	Title       string                 `json:"title" validate:"required,min=1,max=200"`
	Slug        string                 `json:"slug" validate:"required,min=1,max=100,alphanum_dash"`
	Path        string                 `json:"path" validate:"required"`
	Content     string                 `json:"content" validate:"required"`
	Format      PageFormat             `json:"format" validate:"required"`
	Type        PageType               `json:"type"`
	Status      PageStatus             `json:"status"`
	TemplateID  *uuid.UUID             `json:"template_id,omitempty"`
	ParentID    *uuid.UUID             `json:"parent_id,omitempty"`
	Description string                 `json:"description" validate:"max=500"`
	Keywords    []string               `json:"keywords"`
	Tags        []string               `json:"tags"`
	Metadata    map[string]interface{} `json:"metadata"`
	SEO         SEOSettings            `json:"seo"`
	Settings    PageSettings           `json:"settings"`
	PublishAt   *time.Time             `json:"publish_at,omitempty"`
	CreatedBy   uuid.UUID              `json:"created_by" validate:"required"`
}

// UpdatePageRequest contains data for updating a page
type UpdatePageRequest struct {
	ID          uuid.UUID              `json:"id" validate:"required"`
	Title       *string                `json:"title,omitempty" validate:"omitempty,min=1,max=200"`
	Content     *string                `json:"content,omitempty"`
	Format      *PageFormat            `json:"format,omitempty"`
	Status      *PageStatus            `json:"status,omitempty"`
	Description *string                `json:"description,omitempty" validate:"omitempty,max=500"`
	Keywords    []string               `json:"keywords,omitempty"`
	Tags        []string               `json:"tags,omitempty"`
	Metadata    map[string]interface{} `json:"metadata,omitempty"`
	SEO         *SEOSettings           `json:"seo,omitempty"`
	Settings    *PageSettings          `json:"settings,omitempty"`
	PublishAt   *time.Time             `json:"publish_at,omitempty"`
	UpdatedBy   uuid.UUID              `json:"updated_by" validate:"required"`
}

// SEOSettings contains SEO-related settings for a page
type SEOSettings struct {
	Title            string                 `json:"title"`
	Description      string                 `json:"description"`
	Keywords         []string               `json:"keywords"`
	CanonicalURL     string                 `json:"canonical_url"`
	MetaRobots       string                 `json:"meta_robots"`
	OpenGraph        OpenGraphSettings      `json:"open_graph"`
	TwitterCard      TwitterCardSettings    `json:"twitter_card"`
	StructuredData   map[string]interface{} `json:"structured_data"`
	CustomMeta       map[string]string      `json:"custom_meta"`
	SitemapPriority  float64                `json:"sitemap_priority"`
	SitemapFrequency string                 `json:"sitemap_frequency"`
}

// OpenGraphSettings contains Open Graph meta tags
type OpenGraphSettings struct {
	Title       string `json:"title"`
	Description string `json:"description"`
	Image       string `json:"image"`
	URL         string `json:"url"`
	Type        string `json:"type"`
	SiteName    string `json:"site_name"`
}

// TwitterCardSettings contains Twitter Card meta tags
type TwitterCardSettings struct {
	Card        string `json:"card"`
	Site        string `json:"site"`
	Creator     string `json:"creator"`
	Title       string `json:"title"`
	Description string `json:"description"`
	Image       string `json:"image"`
}

// PageSettings contains page-specific settings
type PageSettings struct {
	IsIndexable    bool                   `json:"is_indexable"`
	AllowComments  bool                   `json:"allow_comments"`
	RequireAuth    bool                   `json:"require_auth"`
	CacheEnabled   bool                   `json:"cache_enabled"`
	CacheDuration  time.Duration          `json:"cache_duration"`
	Layout         string                 `json:"layout"`
	Theme          string                 `json:"theme"`
	CustomCSS      string                 `json:"custom_css"`
	CustomJS       string                 `json:"custom_js"`
	HeaderIncludes []string               `json:"header_includes"`
	FooterIncludes []string               `json:"footer_includes"`
	RedirectURL    string                 `json:"redirect_url"`
	RedirectType   int                    `json:"redirect_type"` // 301, 302, etc.
	AccessRoles    []string               `json:"access_roles"`
	CustomFields   map[string]interface{} `json:"custom_fields"`
}

// CreateTemplateRequest contains data for creating a template
type CreateTemplateRequest struct {
	WorkspaceID uuid.UUID              `json:"workspace_id" validate:"required"`
	Name        string                 `json:"name" validate:"required,min=1,max=100"`
	Slug        string                 `json:"slug" validate:"required,min=1,max=50,alphanum_dash"`
	Description string                 `json:"description" validate:"max=500"`
	Type        TemplateType           `json:"type" validate:"required"`
	Format      TemplateFormat         `json:"format" validate:"required"`
	Content     string                 `json:"content" validate:"required"`
	Variables   []PageTemplateVariable `json:"variables"`
	Partials    []TemplatePartial      `json:"partials"`
	Helpers     []TemplateHelperDef    `json:"helpers"`
	Tags        []string               `json:"tags"`
	Metadata    map[string]interface{} `json:"metadata"`
	IsActive    bool                   `json:"is_active"`
	CreatedBy   uuid.UUID              `json:"created_by" validate:"required"`
}

// PageTemplateVariable represents a template variable definition
type PageTemplateVariable struct {
	Name        string                 `json:"name" validate:"required"`
	Type        string                 `json:"type" validate:"required"` // string, number, boolean, array, object
	Default     interface{}            `json:"default"`
	Required    bool                   `json:"required"`
	Description string                 `json:"description"`
	Options     []string               `json:"options,omitempty"` // for enum types
	Validation  PageVariableValidation `json:"validation"`
}

// PageVariableValidation contains validation rules for template variables
type PageVariableValidation struct {
	MinLength *int     `json:"min_length,omitempty"`
	MaxLength *int     `json:"max_length,omitempty"`
	Pattern   string   `json:"pattern,omitempty"`
	Min       *float64 `json:"min,omitempty"`
	Max       *float64 `json:"max,omitempty"`
}

// TemplatePartial represents a template partial
type TemplatePartial struct {
	Name        string `json:"name" validate:"required"`
	Content     string `json:"content" validate:"required"`
	Description string `json:"description"`
}

// TemplateHelperDef represents a template helper definition
type TemplateHelperDef struct {
	Name        string            `json:"name" validate:"required"`
	Description string            `json:"description"`
	Parameters  []HelperParameter `json:"parameters"`
	ReturnType  string            `json:"return_type"`
	Example     string            `json:"example"`
	Code        string            `json:"code"`
}

// HelperParameter represents a helper function parameter
type HelperParameter struct {
	Name        string `json:"name"`
	Type        string `json:"type"`
	Required    bool   `json:"required"`
	Description string `json:"description"`
}

// RenderRequest contains data for template rendering
type RenderRequest struct {
	TemplateID *uuid.UUID             `json:"template_id,omitempty"`
	Template   string                 `json:"template,omitempty"`
	Format     TemplateFormat         `json:"format" validate:"required"`
	Variables  map[string]interface{} `json:"variables"`
	Context    RenderContext          `json:"context"`
	Options    RenderOptions          `json:"options"`
}

// RenderContext provides context for template rendering
type RenderContext struct {
	WorkspaceID uuid.UUID              `json:"workspace_id"`
	PageID      *uuid.UUID             `json:"page_id,omitempty"`
	UserID      uuid.UUID              `json:"user_id"`
	RequestPath string                 `json:"request_path"`
	BaseURL     string                 `json:"base_url"`
	Theme       string                 `json:"theme"`
	Language    string                 `json:"language"`
	Metadata    map[string]interface{} `json:"metadata"`
}

// RenderOptions contains rendering options
type RenderOptions struct {
	CacheEnabled   bool          `json:"cache_enabled"`
	CacheDuration  time.Duration `json:"cache_duration"`
	MinifyHTML     bool          `json:"minify_html"`
	MinifyCSS      bool          `json:"minify_css"`
	MinifyJS       bool          `json:"minify_js"`
	InlineCSS      bool          `json:"inline_css"`
	InlineJS       bool          `json:"inline_js"`
	CompressImages bool          `json:"compress_images"`
	LazyLoadImages bool          `json:"lazy_load_images"`
	GenerateAMP    bool          `json:"generate_amp"`
}

// RenderResult contains the result of template rendering
type RenderResult struct {
	Success         bool                   `json:"success"`
	RenderedContent string                 `json:"rendered_content"`
	ContentType     string                 `json:"content_type"`
	Assets          []RenderAsset          `json:"assets"`
	Metadata        map[string]interface{} `json:"metadata"`
	CacheKey        string                 `json:"cache_key"`
	CacheDuration   time.Duration          `json:"cache_duration"`
	RenderTime      time.Duration          `json:"render_time"`
	Errors          []RenderError          `json:"errors"`
	Warnings        []RenderWarning        `json:"warnings"`
	RenderedAt      time.Time              `json:"rendered_at"`
}

// RenderAsset represents an asset used in rendering
type RenderAsset struct {
	Type string `json:"type"` // css, js, image, font
	URL  string `json:"url"`
	Size int64  `json:"size"`
	Hash string `json:"hash"`
}

// RenderError represents a rendering error
type RenderError struct {
	Code     string `json:"code"`
	Message  string `json:"message"`
	Location string `json:"location"`
	Line     int    `json:"line"`
	Column   int    `json:"column"`
}

// RenderWarning represents a rendering warning
type RenderWarning struct {
	Code       string `json:"code"`
	Message    string `json:"message"`
	Location   string `json:"location"`
	Suggestion string `json:"suggestion"`
}

// CompiledTemplate represents a compiled template
type CompiledTemplate struct {
	ID              uuid.UUID              `json:"id"`
	Name            string                 `json:"name"`
	Format          TemplateFormat         `json:"format"`
	CompiledContent string                 `json:"compiled_content"`
	Variables       []PageTemplateVariable `json:"variables"`
	Dependencies    []string               `json:"dependencies"`
	CacheKey        string                 `json:"cache_key"`
	CompiledAt      time.Time              `json:"compiled_at"`
	ExpiresAt       time.Time              `json:"expires_at"`
}

// TemplateHelper represents a template helper function
type TemplateHelper func(args ...interface{}) (interface{}, error)

// SEOOptimizationRequest contains data for SEO optimization
type SEOOptimizationRequest struct {
	PageID         uuid.UUID              `json:"page_id" validate:"required"`
	Content        string                 `json:"content" validate:"required"`
	Metadata       map[string]interface{} `json:"metadata"`
	Options        SEOOptimizationOptions `json:"options"`
	TargetKeywords []string               `json:"target_keywords"`
}

// SEOOptimizationOptions contains SEO optimization options
type SEOOptimizationOptions struct {
	GenerateMetaTags       bool `json:"generate_meta_tags"`
	GenerateStructuredData bool `json:"generate_structured_data"`
	OptimizeHeadings       bool `json:"optimize_headings"`
	OptimizeImages         bool `json:"optimize_images"`
	OptimizeLinks          bool `json:"optimize_links"`
	CheckReadability       bool `json:"check_readability"`
	CheckKeywordDensity    bool `json:"check_keyword_density"`
}

// SEOOptimizationResult contains the result of SEO optimization
type SEOOptimizationResult struct {
	Success          bool                `json:"success"`
	OptimizedContent string              `json:"optimized_content"`
	MetaTags         *MetaTags           `json:"meta_tags"`
	StructuredData   *StructuredData     `json:"structured_data"`
	Recommendations  []SEORecommendation `json:"recommendations"`
	Issues           []SEOIssue          `json:"issues"`
	Score            SEOScore            `json:"score"`
	OptimizedAt      time.Time           `json:"optimized_at"`
}

// MetaTags contains HTML meta tags
type MetaTags struct {
	Title       string            `json:"title"`
	Description string            `json:"description"`
	Keywords    string            `json:"keywords"`
	Author      string            `json:"author"`
	Canonical   string            `json:"canonical"`
	Robots      string            `json:"robots"`
	Viewport    string            `json:"viewport"`
	OpenGraph   map[string]string `json:"open_graph"`
	TwitterCard map[string]string `json:"twitter_card"`
	Custom      map[string]string `json:"custom"`
}

// StructuredData contains structured data markup
type StructuredData struct {
	Type       string                 `json:"type"` // Article, WebPage, Organization, etc.
	Properties map[string]interface{} `json:"properties"`
	JSONLD     string                 `json:"json_ld"`
}

// SEORecommendation represents an SEO recommendation
type SEORecommendation struct {
	Type       string `json:"type"` // title, description, headings, images, links
	Message    string `json:"message"`
	Action     string `json:"action"`
	Impact     string `json:"impact"`     // high, medium, low
	Difficulty string `json:"difficulty"` // easy, medium, hard
	Example    string `json:"example"`
}

// SEOIssue represents an SEO issue
type SEOIssue struct {
	Type     string `json:"type"`
	Message  string `json:"message"`
	Severity string `json:"severity"` // critical, warning, info
	Location string `json:"location"`
	Fix      string `json:"fix"`
}

// SEOScore represents SEO scoring
type SEOScore struct {
	Overall     int `json:"overall"`
	Technical   int `json:"technical"`
	Content     int `json:"content"`
	Links       int `json:"links"`
	Images      int `json:"images"`
	Performance int `json:"performance"`
	Mobile      int `json:"mobile"`
}

// SEOAnalysis contains comprehensive SEO analysis
type SEOAnalysis struct {
	Score           SEOScore            `json:"score"`
	Issues          []SEOIssue          `json:"issues"`
	Recommendations []SEORecommendation `json:"recommendations"`
	Keywords        KeywordAnalysis     `json:"keywords"`
	Readability     ReadabilityAnalysis `json:"readability"`
	Performance     PerformanceAnalysis `json:"performance"`
	AnalyzedAt      time.Time           `json:"analyzed_at"`
}

// KeywordAnalysis contains keyword analysis results
type KeywordAnalysis struct {
	Density      map[string]float64 `json:"density"`
	Count        map[string]int     `json:"count"`
	Prominence   map[string]float64 `json:"prominence"`
	Distribution map[string][]int   `json:"distribution"`
	Suggestions  []string           `json:"suggestions"`
}

// ReadabilityAnalysis contains readability analysis results
type ReadabilityAnalysis struct {
	FleschScore             float64  `json:"flesch_score"`
	FleschKincaidLevel      float64  `json:"flesch_kincaid_level"`
	AverageWordsPerSentence float64  `json:"average_words_per_sentence"`
	AverageSyllablesPerWord float64  `json:"average_syllables_per_word"`
	ReadingLevel            string   `json:"reading_level"`
	Suggestions             []string `json:"suggestions"`
}

// PerformanceAnalysis contains performance analysis results
type PerformanceAnalysis struct {
	PageSize        int64         `json:"page_size"`
	LoadTime        time.Duration `json:"load_time"`
	ImageCount      int           `json:"image_count"`
	ScriptCount     int           `json:"script_count"`
	StylesheetCount int           `json:"stylesheet_count"`
	Suggestions     []string      `json:"suggestions"`
}

// Sitemap represents an XML sitemap
type Sitemap struct {
	URLs        []SitemapURL `json:"urls"`
	GeneratedAt time.Time    `json:"generated_at"`
	XMLContent  string       `json:"xml_content"`
}

// SitemapURL represents a sitemap URL entry
type SitemapURL struct {
	Location     string    `json:"location"`
	LastModified time.Time `json:"last_modified"`
	ChangeFreq   string    `json:"change_freq"`
	Priority     float64   `json:"priority"`
}

// Asset management types

// AssetUploadRequest contains data for asset upload
type AssetUploadRequest struct {
	WorkspaceID uuid.UUID              `json:"workspace_id" validate:"required"`
	Name        string                 `json:"name" validate:"required"`
	Filename    string                 `json:"filename" validate:"required"`
	MimeType    string                 `json:"mime_type" validate:"required"`
	Size        int64                  `json:"size" validate:"required"`
	Data        []byte                 `json:"data" validate:"required"`
	Alt         string                 `json:"alt"`
	Title       string                 `json:"title"`
	Description string                 `json:"description"`
	Tags        []string               `json:"tags"`
	Metadata    map[string]interface{} `json:"metadata"`
	UploadedBy  uuid.UUID              `json:"uploaded_by" validate:"required"`
}

// Asset represents a file asset
type Asset struct {
	ID           uuid.UUID              `json:"id"`
	WorkspaceID  uuid.UUID              `json:"workspace_id"`
	Name         string                 `json:"name"`
	Filename     string                 `json:"filename"`
	MimeType     string                 `json:"mime_type"`
	Size         int64                  `json:"size"`
	Type         AssetType              `json:"type"`
	URL          string                 `json:"url"`
	CDNUrl       string                 `json:"cdn_url"`
	ThumbnailURL string                 `json:"thumbnail_url"`
	Alt          string                 `json:"alt"`
	Title        string                 `json:"title"`
	Description  string                 `json:"description"`
	Tags         []string               `json:"tags"`
	UsageCount   int                    `json:"usage_count"`
	Metadata     map[string]interface{} `json:"metadata"`
	Hash         string                 `json:"hash"`
	CreatedAt    time.Time              `json:"created_at"`
	UpdatedAt    time.Time              `json:"updated_at"`
	UploadedBy   uuid.UUID              `json:"uploaded_by"`

	// Computed fields
	Uploader *domain.User `json:"uploader,omitempty"`
}

// ImageOptimizationOptions contains image optimization options
type ImageOptimizationOptions struct {
	Quality     int    `json:"quality"` // 1-100
	Format      string `json:"format"`  // webp, jpg, png
	MaxWidth    int    `json:"max_width"`
	MaxHeight   int    `json:"max_height"`
	Progressive bool   `json:"progressive"`
	StripMeta   bool   `json:"strip_meta"`
}

// ThumbnailSize represents thumbnail dimensions
type ThumbnailSize struct {
	Width  int    `json:"width"`
	Height int    `json:"height"`
	Crop   bool   `json:"crop"`
	Format string `json:"format"`
}

// Statistics types

// PageStats contains page statistics
type PageStats struct {
	ViewCount         int64              `json:"view_count"`
	UniqueViewers     int64              `json:"unique_viewers"`
	AverageTimeOnPage time.Duration      `json:"average_time_on_page"`
	BounceRate        float64            `json:"bounce_rate"`
	ConversionRate    float64            `json:"conversion_rate"`
	SEOScore          int                `json:"seo_score"`
	PerformanceScore  int                `json:"performance_score"`
	LastViewedAt      *time.Time         `json:"last_viewed_at"`
	PopularityScore   float64            `json:"popularity_score"`
	ViewHistory       []ViewHistoryPoint `json:"view_history"`
	ReferrerBreakdown map[string]int64   `json:"referrer_breakdown"`
	DeviceBreakdown   map[string]int64   `json:"device_breakdown"`
	LocationBreakdown map[string]int64   `json:"location_breakdown"`
}

// WorkspacePageStats contains workspace-level page statistics
type WorkspacePageStats struct {
	TotalPages         int                         `json:"total_pages"`
	PublishedPages     int                         `json:"published_pages"`
	DraftPages         int                         `json:"draft_pages"`
	TotalViews         int64                       `json:"total_views"`
	UniqueVisitors     int64                       `json:"unique_visitors"`
	PagesByType        map[PageType]int            `json:"pages_by_type"`
	PagesByFormat      map[PageFormat]int          `json:"pages_by_format"`
	TopPages           []*domain.Page              `json:"top_pages"`
	RecentPages        []*domain.Page              `json:"recent_pages"`
	SEOMetrics         WorkspaceSEOMetrics         `json:"seo_metrics"`
	PerformanceMetrics WorkspacePerformanceMetrics `json:"performance_metrics"`
}

// WorkspaceSEOMetrics represents workspace SEO metrics
type WorkspaceSEOMetrics struct {
	AverageSEOScore    float64         `json:"average_seo_score"`
	IndexedPages       int             `json:"indexed_pages"`
	PagesWithIssues    int             `json:"pages_with_issues"`
	TopKeywords        []KeywordMetric `json:"top_keywords"`
	SitemapLastUpdated *time.Time      `json:"sitemap_last_updated"`
}

// WorkspacePerformanceMetrics represents workspace performance metrics
type WorkspacePerformanceMetrics struct {
	AverageLoadTime   time.Duration `json:"average_load_time"`
	AveragePageSize   int64         `json:"average_page_size"`
	CacheHitRate      float64       `json:"cache_hit_rate"`
	OptimizedAssets   int           `json:"optimized_assets"`
	UnoptimizedAssets int           `json:"unoptimized_assets"`
}

// KeywordMetric represents keyword metrics
type KeywordMetric struct {
	Keyword   string  `json:"keyword"`
	Frequency int     `json:"frequency"`
	Density   float64 `json:"density"`
	Pages     int     `json:"pages"`
}

// PageService implements business logic for page operations
type PageService struct {
	pageRepo       PageRepository
	workspaceRepo  WorkspaceRepository
	userRepo       UserRepository
	templateEngine TemplateEngine
	seoOptimizer   SEOOptimizer
	assetManager   AssetManager
	eventPub       EventPublisher
	cache          CacheManager
	logger         *slog.Logger
}

// NewPageService creates a new page service instance
func NewPageService(
	pageRepo PageRepository,
	workspaceRepo WorkspaceRepository,
	userRepo UserRepository,
	templateEngine TemplateEngine,
	seoOptimizer SEOOptimizer,
	assetManager AssetManager,
	eventPub EventPublisher,
	cache CacheManager,
	logger *slog.Logger,
) *PageService {
	return &PageService{
		pageRepo:       pageRepo,
		workspaceRepo:  workspaceRepo,
		userRepo:       userRepo,
		templateEngine: templateEngine,
		seoOptimizer:   seoOptimizer,
		assetManager:   assetManager,
		eventPub:       eventPub,
		cache:          cache,
		logger:         logger.With("service", "page"),
	}
}

// CreatePage creates a new page with validation and processing
func (s *PageService) CreatePage(ctx context.Context, req CreatePageRequest) (*domain.Page, error) {
	s.logger.InfoContext(ctx, "Creating page",
		"title", req.Title, "path", req.Path, "workspace_id", req.WorkspaceID, "created_by", req.CreatedBy)

	// Validate the request
	if err := s.validateCreatePageRequest(ctx, req); err != nil {
		return nil, fmt.Errorf("validation failed: %w", err)
	}

	// Check workspace exists and user has permission
	workspace, err := s.workspaceRepo.GetByID(ctx, req.WorkspaceID)
	if err != nil {
		return nil, fmt.Errorf("failed to get workspace: %w", err)
	}

	if !s.canUserCreatePage(ctx, workspace, req.CreatedBy) {
		return nil, domain.ErrInsufficientPermission
	}

	// Check page slug and path availability
	if exists, err := s.checkPageExists(ctx, req.WorkspaceID, req.Slug, req.Path); err != nil {
		return nil, fmt.Errorf("failed to check page existence: %w", err)
	} else if exists {
		return nil, ErrPageExists
	}

	// Create the page domain object
	now := time.Now()
	page := &domain.Page{
		ID:          uuid.New(),
		WorkspaceID: req.WorkspaceID,
		Title:       req.Title,
		Slug:        req.Slug,
		Path:        req.Path,
		Content:     req.Content,
		Format:      string(req.Format),
		Type:        string(req.Type),
		Status:      string(req.Status),
		TemplateID:  req.TemplateID,
		ParentID:    req.ParentID,
		Description: req.Description,
		Keywords:    req.Keywords,
		Tags:        req.Tags,
		PublishAt:   req.PublishAt,
		CreatedAt:   now,
		UpdatedAt:   now,
		CreatedBy:   req.CreatedBy,
		UpdatedBy:   req.CreatedBy,
	}

	// Set default values if not provided
	if page.Status == "" {
		page.Status = string(PageStatusDraft)
	}
	if page.Type == "" {
		page.Type = string(PageTypeStatic)
	}

	// Process SEO settings
	if req.SEO.Title != "" || req.SEO.Description != "" {
		page.SEOTitle = req.SEO.Title
		page.SEODescription = req.SEO.Description
		page.SEOKeywords = req.SEO.Keywords
	}

	// Persist the page
	if err := s.pageRepo.Create(ctx, page); err != nil {
		return nil, fmt.Errorf("failed to create page: %w", err)
	}

	// Clear relevant caches
	s.clearPageListCaches(ctx, req.WorkspaceID)

	// TODO: Publish page created event when EventPublisher is updated

	s.logger.InfoContext(ctx, "Page created successfully",
		"page_id", page.ID, "title", page.Title, "path", page.Path)

	return page, nil
}

// RenderPage renders a page using the template engine
func (s *PageService) RenderPage(ctx context.Context, pageID uuid.UUID, context RenderContext, options RenderOptions) (*RenderResult, error) {
	s.logger.DebugContext(ctx, "Rendering page", "page_id", pageID, "user_id", context.UserID)

	// Check cache first if enabled
	cacheKey := fmt.Sprintf("page:rendered:%s:%s", pageID.String(), s.calculateContextHash(context))
	if options.CacheEnabled {
		if cached, err := s.cache.Get(ctx, cacheKey); err == nil {
			if result, ok := cached.(*RenderResult); ok {
				s.logger.DebugContext(ctx, "Returning cached page render", "page_id", pageID)
				return result, nil
			}
		}
	}

	// Get the page
	page, err := s.pageRepo.GetByID(ctx, pageID)
	if err != nil {
		return nil, fmt.Errorf("failed to get page: %w", err)
	}

	// Check access permissions
	workspace, err := s.workspaceRepo.GetByID(ctx, page.WorkspaceID)
	if err != nil {
		return nil, fmt.Errorf("failed to get workspace: %w", err)
	}

	if !s.canUserAccessPage(ctx, page, workspace, context.UserID) {
		return nil, domain.ErrInsufficientPermission
	}

	// Prepare render request
	renderReq := &RenderRequest{
		Template: page.Content,
		Format:   TemplateFormatHandlebars, // Default format
		Variables: map[string]interface{}{
			"page":      page,
			"workspace": workspace,
			"user":      context.UserID,
			"path":      context.RequestPath,
			"base_url":  context.BaseURL,
			"theme":     context.Theme,
			"language":  context.Language,
		},
		Context: context,
		Options: options,
	}

	// Use specific template if specified
	if page.TemplateID != nil {
		renderReq.TemplateID = page.TemplateID
	}

	// Render the page
	result, err := s.templateEngine.RenderTemplate(ctx, renderReq)
	if err != nil {
		return nil, fmt.Errorf("failed to render page: %w", err)
	}

	// Cache the result if enabled
	if options.CacheEnabled && result.Success {
		s.cache.Set(ctx, cacheKey, result, options.CacheDuration)
	}

	// Record page view
	if err := s.pageRepo.RecordPageView(ctx, pageID, context.UserID, map[string]interface{}{
		"path":       context.RequestPath,
		"referrer":   context.Metadata["referrer"],
		"user_agent": context.Metadata["user_agent"],
	}); err != nil {
		s.logger.WarnContext(ctx, "Failed to record page view", "error", err)
	}

	return result, nil
}

// CreateTemplate creates a new page template
func (s *PageService) CreateTemplate(ctx context.Context, req CreateTemplateRequest) (*domain.PageTemplate, error) {
	s.logger.InfoContext(ctx, "Creating page template",
		"name", req.Name, "type", req.Type, "workspace_id", req.WorkspaceID, "created_by", req.CreatedBy)

	// Validate the request
	if err := s.validateCreateTemplateRequest(ctx, req); err != nil {
		return nil, fmt.Errorf("validation failed: %w", err)
	}

	// Check workspace exists and user has permission
	workspace, err := s.workspaceRepo.GetByID(ctx, req.WorkspaceID)
	if err != nil {
		return nil, fmt.Errorf("failed to get workspace: %w", err)
	}

	if !s.canUserCreateTemplate(ctx, workspace, req.CreatedBy) {
		return nil, domain.ErrInsufficientPermission
	}

	// Check template name availability
	if exists, err := s.checkTemplateExists(ctx, req.WorkspaceID, req.Name); err != nil {
		return nil, fmt.Errorf("failed to check template existence: %w", err)
	} else if exists {
		return nil, ErrTemplateExists
	}

	// Validate template content
	if _, err := s.templateEngine.ValidateTemplate(ctx, req.Content, req.Format); err != nil {
		return nil, fmt.Errorf("template validation failed: %w", err)
	}

	// Create the template domain object
	now := time.Now()
	template := &domain.PageTemplate{
		ID:          uuid.New(),
		WorkspaceID: req.WorkspaceID,
		Name:        req.Name,
		Slug:        req.Slug,
		Description: req.Description,
		Type:        string(req.Type),
		Format:      string(req.Format),
		Content:     req.Content,
		Tags:        req.Tags,
		Active:      req.IsActive,
		CreatedAt:   now,
		UpdatedAt:   now,
		CreatedBy:   req.CreatedBy,
		UpdatedBy:   req.CreatedBy,
	}

	// Persist the template
	if err := s.pageRepo.CreateTemplate(ctx, template); err != nil {
		return nil, fmt.Errorf("failed to create template: %w", err)
	}

	// Clear relevant caches
	s.clearTemplateListCaches(ctx, req.WorkspaceID)

	// TODO: Publish template created event when EventPublisher is updated

	s.logger.InfoContext(ctx, "Page template created successfully",
		"template_id", template.ID, "name", template.Name)

	return template, nil
}

// OptimizeSEO optimizes a page for SEO
func (s *PageService) OptimizeSEO(ctx context.Context, pageID uuid.UUID, options SEOOptimizationOptions) (*SEOOptimizationResult, error) {
	s.logger.InfoContext(ctx, "Optimizing page SEO", "page_id", pageID)

	// Get the page
	page, err := s.pageRepo.GetByID(ctx, pageID)
	if err != nil {
		return nil, fmt.Errorf("failed to get page: %w", err)
	}

	// Check permissions (simplified - get user ID from context)
	userID := uuid.New() // This would come from authentication context
	workspace, err := s.workspaceRepo.GetByID(ctx, page.WorkspaceID)
	if err != nil {
		return nil, fmt.Errorf("failed to get workspace: %w", err)
	}

	if !s.canUserModifyPage(ctx, page, workspace, userID) {
		return nil, domain.ErrInsufficientPermission
	}

	// Prepare optimization request
	optimizationReq := &SEOOptimizationRequest{
		PageID:  pageID,
		Content: page.Content,
		Metadata: map[string]interface{}{
			"title":       page.Title,
			"description": page.Description,
			"keywords":    page.Keywords,
		},
		Options: options,
	}

	// Optimize the page
	result, err := s.seoOptimizer.OptimizePage(ctx, optimizationReq)
	if err != nil {
		return nil, fmt.Errorf("failed to optimize page: %w", err)
	}

	return result, nil
}

// Helper methods

// validateCreatePageRequest validates a create page request
func (s *PageService) validateCreatePageRequest(ctx context.Context, req CreatePageRequest) error {
	if req.Title == "" {
		return ErrInvalidPageTitle
	}

	if req.Slug == "" {
		return ErrInvalidPageSlug
	}

	if req.Path == "" {
		return ErrInvalidPagePath
	}

	if req.Content == "" {
		return ErrInvalidPageContent
	}

	if req.WorkspaceID == uuid.Nil {
		return ErrInvalidWorkspaceID
	}

	if req.CreatedBy == uuid.Nil {
		return ErrInvalidUserID
	}

	// Validate slug format
	if !s.isValidSlug(req.Slug) {
		return ErrInvalidPageSlug
	}

	// Validate path format
	if !s.isValidPath(req.Path) {
		return ErrInvalidPagePath
	}

	// Validate format
	validFormats := []PageFormat{PageFormatHTML, PageFormatMarkdown, PageFormatMDX, PageFormatJSON, PageFormatYAML}
	isValidFormat := false
	for _, validFormat := range validFormats {
		if req.Format == validFormat {
			isValidFormat = true
			break
		}
	}
	if !isValidFormat {
		return ErrInvalidPageFormat
	}

	return nil
}

// validateCreateTemplateRequest validates a create template request
func (s *PageService) validateCreateTemplateRequest(ctx context.Context, req CreateTemplateRequest) error {
	if req.Name == "" {
		return ErrInvalidTemplateName
	}

	if req.Content == "" {
		return ErrInvalidTemplateContent
	}

	if req.WorkspaceID == uuid.Nil {
		return ErrInvalidWorkspaceID
	}

	if req.CreatedBy == uuid.Nil {
		return ErrInvalidUserID
	}

	// Validate template type
	validTypes := []TemplateType{TemplateTypeLayout, TemplateTypePage, TemplateTypePartial, TemplateTypeComponent, TemplateTypeEmail}
	isValidType := false
	for _, validType := range validTypes {
		if req.Type == validType {
			isValidType = true
			break
		}
	}
	if !isValidType {
		return ErrInvalidTemplateType
	}

	return nil
}

// checkPageExists checks if a page with the same slug or path exists
func (s *PageService) checkPageExists(ctx context.Context, workspaceID uuid.UUID, slug, path string) (bool, error) {
	if existing, err := s.pageRepo.GetBySlug(ctx, workspaceID, slug); err == nil && existing != nil {
		return true, nil
	}

	if existing, err := s.pageRepo.GetByPath(ctx, workspaceID, path); err == nil && existing != nil {
		return true, nil
	}

	return false, nil
}

// checkTemplateExists checks if a template with the same name exists
func (s *PageService) checkTemplateExists(ctx context.Context, workspaceID uuid.UUID, name string) (bool, error) {
	existing, err := s.pageRepo.GetTemplateByName(ctx, workspaceID, name)
	if err != nil {
		return false, nil // Assume not found
	}
	return existing != nil, nil
}

// isValidSlug validates slug format
func (s *PageService) isValidSlug(slug string) bool {
	matched, _ := regexp.MatchString(`^[a-zA-Z0-9_-]+$`, slug)
	return matched && len(slug) >= 1 && len(slug) <= 100
}

// isValidPath validates path format
func (s *PageService) isValidPath(path string) bool {
	matched, _ := regexp.MatchString(`^/[a-zA-Z0-9/_-]*$`, path)
	return matched && len(path) >= 1 && len(path) <= 500
}

// calculateContextHash calculates a hash of the render context for caching
func (s *PageService) calculateContextHash(context RenderContext) string {
	// Simplified hash calculation - use SHA256 in production
	return fmt.Sprintf("ctx-%x", context.UserID)
}

// Permission checking methods

func (s *PageService) canUserCreatePage(ctx context.Context, workspace *domain.Workspace, userID uuid.UUID) bool {
	member := workspace.GetMember(userID)
	if member == nil {
		return false
	}

	return member.Role == domain.WorkspaceRoleOwner ||
		member.Role == domain.WorkspaceRoleAdmin ||
		member.Role == domain.WorkspaceRoleDeveloper
}

func (s *PageService) canUserCreateTemplate(ctx context.Context, workspace *domain.Workspace, userID uuid.UUID) bool {
	member := workspace.GetMember(userID)
	if member == nil {
		return false
	}

	return member.Role == domain.WorkspaceRoleOwner ||
		member.Role == domain.WorkspaceRoleAdmin ||
		member.Role == domain.WorkspaceRoleDeveloper
}

func (s *PageService) canUserAccessPage(ctx context.Context, page *domain.Page, workspace *domain.Workspace, userID uuid.UUID) bool {
	// Page creator can always access
	if page.CreatedBy == userID {
		return true
	}

	// Check if page requires authentication
	if page.RequireAuth {
		return workspace.HasMember(userID)
	}

	// Published pages are generally accessible to workspace members
	if page.Status == string(PageStatusPublished) {
		return workspace.HasMember(userID)
	}

	// Draft pages only accessible to creator and admins
	member := workspace.GetMember(userID)
	if member == nil {
		return false
	}

	return member.Role == domain.WorkspaceRoleOwner ||
		member.Role == domain.WorkspaceRoleAdmin ||
		page.CreatedBy == userID
}

func (s *PageService) canUserModifyPage(ctx context.Context, page *domain.Page, workspace *domain.Workspace, userID uuid.UUID) bool {
	// Page creator can modify
	if page.CreatedBy == userID {
		return true
	}

	// Check workspace permissions
	member := workspace.GetMember(userID)
	if member == nil {
		return false
	}

	return member.Role == domain.WorkspaceRoleOwner ||
		member.Role == domain.WorkspaceRoleAdmin
}

// Cache management

func (s *PageService) clearPageListCaches(ctx context.Context, workspaceID uuid.UUID) {
	patterns := []string{
		fmt.Sprintf("workspace:pages:%s", workspaceID.String()),
		"pages:list:*",
		"page_stats:*",
	}

	for _, pattern := range patterns {
		if err := s.cache.DeleteByPattern(ctx, pattern); err != nil {
			s.logger.WarnContext(ctx, "Failed to clear cache", "pattern", pattern, "error", err)
		}
	}
}

func (s *PageService) clearTemplateListCaches(ctx context.Context, workspaceID uuid.UUID) {
	patterns := []string{
		fmt.Sprintf("workspace:templates:%s", workspaceID.String()),
		"templates:list:*",
		"template:compiled:*",
	}

	for _, pattern := range patterns {
		if err := s.cache.DeleteByPattern(ctx, pattern); err != nil {
			s.logger.WarnContext(ctx, "Failed to clear cache", "pattern", pattern, "error", err)
		}
	}
}

// Service-specific errors
var (
	ErrInvalidPageTitle       = domain.NewDomainError("INVALID_PAGE_TITLE", "Page title is invalid")
	ErrInvalidPageSlug        = domain.NewDomainError("INVALID_PAGE_SLUG", "Page slug is invalid")
	ErrInvalidPagePath        = domain.NewDomainError("INVALID_PAGE_PATH", "Page path is invalid")
	ErrInvalidPageContent     = domain.NewDomainError("INVALID_PAGE_CONTENT", "Page content is invalid")
	ErrInvalidPageFormat      = domain.NewDomainError("INVALID_PAGE_FORMAT", "Page format is invalid")
	ErrInvalidTemplateName    = domain.NewDomainError("INVALID_TEMPLATE_NAME", "Template name is invalid")
	ErrInvalidTemplateContent = domain.NewDomainError("INVALID_TEMPLATE_CONTENT", "Template content is invalid")
	ErrInvalidTemplateType    = domain.NewDomainError("INVALID_TEMPLATE_TYPE", "Template type is invalid")
	ErrPageExists             = domain.NewDomainError("PAGE_EXISTS", "Page already exists")
	ErrPageNotFound           = domain.NewDomainError("PAGE_NOT_FOUND", "Page not found")
	ErrTemplateExists         = domain.NewDomainError("TEMPLATE_EXISTS", "Template already exists")
	ErrPageTemplateNotFound   = domain.NewDomainError("PAGE_TEMPLATE_NOT_FOUND", "Page template not found")
	ErrRenderingFailed        = domain.NewDomainError("RENDERING_FAILED", "Page rendering failed")
	ErrSEOOptimizationFailed  = domain.NewDomainError("SEO_OPTIMIZATION_FAILED", "SEO optimization failed")
	ErrAssetUploadFailed      = domain.NewDomainError("ASSET_UPLOAD_FAILED", "Asset upload failed")
)
