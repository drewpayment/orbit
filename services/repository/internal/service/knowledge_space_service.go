/**
 * T039 - Service Layer: KnowledgeSpaceService with Content Management
 *
 * This service implements business logic for knowledge space operations including
 * content management, article publishing, collaboration features, search and discovery,
 * and integration with workspace and repository systems.
 *
 * Constitutional Requirements:
 * - Rich content authoring with version control
 * - Multi-format content support (Markdown, HTML, structured data)
 * - Collaborative editing and review workflows
 * - Advanced search and discovery capabilities
 * - Multi-tenant workspace isolation
 * - Comprehensive audit trails and analytics
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

// KnowledgeSpaceRepository defines the repository interface for knowledge space operations
type KnowledgeSpaceRepository interface {
	// Basic CRUD operations
	Create(ctx context.Context, knowledgeSpace *domain.KnowledgeSpace) error
	Update(ctx context.Context, knowledgeSpace *domain.KnowledgeSpace) error
	Delete(ctx context.Context, id uuid.UUID) error
	GetByID(ctx context.Context, id uuid.UUID) (*domain.KnowledgeSpace, error)
	GetBySlug(ctx context.Context, workspaceID uuid.UUID, slug string) (*domain.KnowledgeSpace, error)

	// Article operations
	CreateArticle(ctx context.Context, article *domain.KnowledgeArticle) error
	UpdateArticle(ctx context.Context, article *domain.KnowledgeArticle) error
	DeleteArticle(ctx context.Context, id uuid.UUID) error
	GetArticleByID(ctx context.Context, id uuid.UUID) (*domain.KnowledgeArticle, error)
	GetArticleBySlug(ctx context.Context, spaceID uuid.UUID, slug string) (*domain.KnowledgeArticle, error)

	// Version management
	CreateArticleVersion(ctx context.Context, version *domain.KnowledgeArticleVersion) error
	GetArticleVersion(ctx context.Context, articleID uuid.UUID, version string) (*domain.KnowledgeArticleVersion, error)
	GetLatestArticleVersion(ctx context.Context, articleID uuid.UUID) (*domain.KnowledgeArticleVersion, error)
	ListArticleVersions(ctx context.Context, articleID uuid.UUID) ([]*domain.KnowledgeArticleVersion, error)

	// Listing and search
	ListSpacesByWorkspace(ctx context.Context, workspaceID uuid.UUID, filters KnowledgeSpaceFilters) ([]*domain.KnowledgeSpace, error)
	ListArticlesBySpace(ctx context.Context, spaceID uuid.UUID, filters KnowledgeArticleFilters) ([]*domain.KnowledgeArticle, error)
	SearchArticles(ctx context.Context, workspaceID uuid.UUID, query string, filters KnowledgeArticleFilters) ([]*domain.KnowledgeArticle, error)

	// Categories and tags
	GetCategoriesBySpace(ctx context.Context, spaceID uuid.UUID) ([]*KnowledgeCategory, error)
	GetTagsBySpace(ctx context.Context, spaceID uuid.UUID) ([]*KnowledgeTag, error)

	// Analytics and statistics
	GetSpaceStats(ctx context.Context, spaceID uuid.UUID) (*KnowledgeSpaceStats, error)
	GetArticleStats(ctx context.Context, articleID uuid.UUID) (*KnowledgeArticleStats, error)
	RecordArticleView(ctx context.Context, articleID, userID uuid.UUID) error
	RecordArticleReaction(ctx context.Context, reaction *KnowledgeArticleReaction) error
}

// ContentProcessor defines the interface for content processing operations
type ContentProcessor interface {
	ProcessContent(ctx context.Context, req *ContentProcessingRequest) (*ContentProcessingResult, error)
	ValidateContent(ctx context.Context, content string, format ContentFormat) (*ContentValidationResult, error)
	ExtractMetadata(ctx context.Context, content string, format ContentFormat) (*ContentMetadata, error)
	GenerateExcerpt(ctx context.Context, content string, maxLength int) (string, error)
	ConvertFormat(ctx context.Context, content string, from, to ContentFormat) (*ContentConversionResult, error)
}

// SearchEngine defines the interface for content search operations
type SearchEngine interface {
	IndexArticle(ctx context.Context, article *domain.KnowledgeArticle) error
	UpdateIndex(ctx context.Context, article *domain.KnowledgeArticle) error
	RemoveFromIndex(ctx context.Context, articleID uuid.UUID) error
	Search(ctx context.Context, req *SearchRequest) (*SearchResult, error)
	Suggest(ctx context.Context, req *SuggestionRequest) (*SuggestionResult, error)
	GetSimilarArticles(ctx context.Context, articleID uuid.UUID, limit int) ([]*domain.KnowledgeArticle, error)
}

// ContentFormat represents supported content formats
type ContentFormat string

const (
	ContentFormatMarkdown  ContentFormat = "markdown"
	ContentFormatHTML      ContentFormat = "html"
	ContentFormatPlainText ContentFormat = "plain_text"
	ContentFormatJSON      ContentFormat = "json"
	ContentFormatYAML      ContentFormat = "yaml"
	ContentFormatRichText  ContentFormat = "rich_text"
	ContentFormatMDX       ContentFormat = "mdx"
)

// ArticleStatus represents the publication status of an article
type ArticleStatus string

const (
	ArticleStatusDraft     ArticleStatus = "draft"
	ArticleStatusReview    ArticleStatus = "review"
	ArticleStatusApproved  ArticleStatus = "approved"
	ArticleStatusPublished ArticleStatus = "published"
	ArticleStatusArchived  ArticleStatus = "archived"
	ArticleStatusDeleted   ArticleStatus = "deleted"
)

// SpaceVisibility represents the visibility of a knowledge space
type SpaceVisibility string

const (
	SpaceVisibilityPrivate  SpaceVisibility = "private"
	SpaceVisibilityInternal SpaceVisibility = "internal"
	SpaceVisibilityPublic   SpaceVisibility = "public"
)

// ReactionType represents types of reactions to articles
type ReactionType string

const (
	ReactionTypeLike       ReactionType = "like"
	ReactionTypeDislike    ReactionType = "dislike"
	ReactionTypeHelpful    ReactionType = "helpful"
	ReactionTypeNotHelpful ReactionType = "not_helpful"
	ReactionTypeBookmark   ReactionType = "bookmark"
	ReactionTypeShare      ReactionType = "share"
)

// KnowledgeSpaceFilters contains filtering options for knowledge space queries
type KnowledgeSpaceFilters struct {
	Visibility    []SpaceVisibility `json:"visibility"`
	CreatedBy     *uuid.UUID        `json:"created_by"`
	UpdatedBy     *uuid.UUID        `json:"updated_by"`
	CreatedAfter  *time.Time        `json:"created_after"`
	CreatedBefore *time.Time        `json:"created_before"`
	HasArticles   *bool             `json:"has_articles"`
	Tags          []string          `json:"tags"`
	Categories    []string          `json:"categories"`
	Limit         int               `json:"limit"`
	Offset        int               `json:"offset"`
	SortBy        string            `json:"sort_by"`    // name, created_at, updated_at, article_count
	SortOrder     string            `json:"sort_order"` // asc, desc
}

// KnowledgeArticleFilters contains filtering options for article queries
type KnowledgeArticleFilters struct {
	Status        []ArticleStatus `json:"status"`
	Format        []ContentFormat `json:"format"`
	CreatedBy     *uuid.UUID      `json:"created_by"`
	UpdatedBy     *uuid.UUID      `json:"updated_by"`
	CreatedAfter  *time.Time      `json:"created_after"`
	CreatedBefore *time.Time      `json:"created_before"`
	Tags          []string        `json:"tags"`
	Categories    []string        `json:"categories"`
	HasVersions   *bool           `json:"has_versions"`
	MinReadTime   *int            `json:"min_read_time"`
	MaxReadTime   *int            `json:"max_read_time"`
	MinViews      *int            `json:"min_views"`
	Limit         int             `json:"limit"`
	Offset        int             `json:"offset"`
	SortBy        string          `json:"sort_by"`    // title, created_at, updated_at, view_count, rating
	SortOrder     string          `json:"sort_order"` // asc, desc
}

// CreateKnowledgeSpaceRequest contains data for creating a knowledge space
type CreateKnowledgeSpaceRequest struct {
	WorkspaceID uuid.UUID       `json:"workspace_id" validate:"required"`
	Name        string          `json:"name" validate:"required,min=1,max=100"`
	Slug        string          `json:"slug" validate:"required,min=1,max=50,alphanum_dash"`
	Description string          `json:"description" validate:"max=500"`
	Visibility  SpaceVisibility `json:"visibility"`
	Icon        string          `json:"icon"`
	Color       string          `json:"color"`
	Tags        []string        `json:"tags"`
	Categories  []string        `json:"categories"`
	Settings    SpaceSettings   `json:"settings"`
	CreatedBy   uuid.UUID       `json:"created_by" validate:"required"`
}

// UpdateKnowledgeSpaceRequest contains data for updating a knowledge space
type UpdateKnowledgeSpaceRequest struct {
	ID          uuid.UUID        `json:"id" validate:"required"`
	Name        *string          `json:"name,omitempty" validate:"omitempty,min=1,max=100"`
	Description *string          `json:"description,omitempty" validate:"omitempty,max=500"`
	Visibility  *SpaceVisibility `json:"visibility,omitempty"`
	Icon        *string          `json:"icon,omitempty"`
	Color       *string          `json:"color,omitempty"`
	Tags        []string         `json:"tags,omitempty"`
	Categories  []string         `json:"categories,omitempty"`
	Settings    *SpaceSettings   `json:"settings,omitempty"`
	UpdatedBy   uuid.UUID        `json:"updated_by" validate:"required"`
}

// SpaceSettings contains configuration settings for a knowledge space
type SpaceSettings struct {
	AllowComments    bool              `json:"allow_comments"`
	AllowReactions   bool              `json:"allow_reactions"`
	RequireApproval  bool              `json:"require_approval"`
	EnableVersioning bool              `json:"enable_versioning"`
	AutoGenerateSlug bool              `json:"auto_generate_slug"`
	DefaultFormat    ContentFormat     `json:"default_format"`
	AllowedFormats   []ContentFormat   `json:"allowed_formats"`
	MaxFileSize      int64             `json:"max_file_size"`
	AllowedFileTypes []string          `json:"allowed_file_types"`
	EnableSearch     bool              `json:"enable_search"`
	SearchIndexing   bool              `json:"search_indexing"`
	EnableAnalytics  bool              `json:"enable_analytics"`
	CustomFields     []CustomField     `json:"custom_fields"`
	Templates        []ContentTemplate `json:"templates"`
}

// CustomField represents a custom field definition
type CustomField struct {
	Key         string                 `json:"key"`
	Name        string                 `json:"name"`
	Type        string                 `json:"type"` // text, number, date, boolean, select, multiselect
	Required    bool                   `json:"required"`
	Default     interface{}            `json:"default"`
	Options     []string               `json:"options,omitempty"` // for select types
	Validation  map[string]interface{} `json:"validation,omitempty"`
	Description string                 `json:"description"`
}

// ContentTemplate represents a content template
type ContentTemplate struct {
	ID          string             `json:"id"`
	Name        string             `json:"name"`
	Description string             `json:"description"`
	Format      ContentFormat      `json:"format"`
	Content     string             `json:"content"`
	Variables   []TemplateVariable `json:"variables"`
	IsDefault   bool               `json:"is_default"`
	CreatedAt   time.Time          `json:"created_at"`
	UpdatedAt   time.Time          `json:"updated_at"`
}

// TemplateVariable represents a template variable
type TemplateVariable struct {
	Name        string      `json:"name"`
	Type        string      `json:"type"`
	Default     interface{} `json:"default"`
	Required    bool        `json:"required"`
	Description string      `json:"description"`
}

// CreateArticleRequest contains data for creating a knowledge article
type CreateArticleRequest struct {
	SpaceID      uuid.UUID              `json:"space_id" validate:"required"`
	Title        string                 `json:"title" validate:"required,min=1,max=200"`
	Slug         string                 `json:"slug" validate:"required,min=1,max=100,alphanum_dash"`
	Content      string                 `json:"content" validate:"required"`
	Format       ContentFormat          `json:"format" validate:"required"`
	Summary      string                 `json:"summary" validate:"max=500"`
	Status       ArticleStatus          `json:"status"`
	Tags         []string               `json:"tags"`
	Categories   []string               `json:"categories"`
	CustomFields map[string]interface{} `json:"custom_fields"`
	PublishAt    *time.Time             `json:"publish_at,omitempty"`
	CreatedBy    uuid.UUID              `json:"created_by" validate:"required"`
}

// UpdateArticleRequest contains data for updating a knowledge article
type UpdateArticleRequest struct {
	ID           uuid.UUID              `json:"id" validate:"required"`
	Title        *string                `json:"title,omitempty" validate:"omitempty,min=1,max=200"`
	Content      *string                `json:"content,omitempty"`
	Format       *ContentFormat         `json:"format,omitempty"`
	Summary      *string                `json:"summary,omitempty" validate:"omitempty,max=500"`
	Status       *ArticleStatus         `json:"status,omitempty"`
	Tags         []string               `json:"tags,omitempty"`
	Categories   []string               `json:"categories,omitempty"`
	CustomFields map[string]interface{} `json:"custom_fields,omitempty"`
	PublishAt    *time.Time             `json:"publish_at,omitempty"`
	UpdatedBy    uuid.UUID              `json:"updated_by" validate:"required"`
}

// CreateArticleVersionRequest contains data for creating an article version
type CreateArticleVersionRequest struct {
	ArticleID   uuid.UUID `json:"article_id" validate:"required"`
	Version     string    `json:"version" validate:"required"`
	Content     string    `json:"content" validate:"required"`
	ChangeNotes string    `json:"change_notes"`
	IsMinor     bool      `json:"is_minor"`
	CreatedBy   uuid.UUID `json:"created_by" validate:"required"`
}

// ContentProcessingRequest contains data for content processing
type ContentProcessingRequest struct {
	Content string            `json:"content" validate:"required"`
	Format  ContentFormat     `json:"format" validate:"required"`
	Options ProcessingOptions `json:"options"`
	Context ProcessingContext `json:"context"`
}

// ProcessingOptions contains content processing options
type ProcessingOptions struct {
	GenerateExcerpt          bool `json:"generate_excerpt"`
	ExtractMetadata          bool `json:"extract_metadata"`
	ValidateContent          bool `json:"validate_content"`
	OptimizeImages           bool `json:"optimize_images"`
	GenerateTOC              bool `json:"generate_toc"`
	SanitizeHTML             bool `json:"sanitize_html"`
	EnableSyntaxHighlighting bool `json:"enable_syntax_highlighting"`
}

// ProcessingContext provides context for content processing
type ProcessingContext struct {
	WorkspaceID uuid.UUID              `json:"workspace_id"`
	SpaceID     uuid.UUID              `json:"space_id"`
	ArticleID   *uuid.UUID             `json:"article_id,omitempty"`
	UserID      uuid.UUID              `json:"user_id"`
	Metadata    map[string]interface{} `json:"metadata"`
}

// ContentProcessingResult contains the result of content processing
type ContentProcessingResult struct {
	ProcessedContent string                   `json:"processed_content"`
	Excerpt          string                   `json:"excerpt"`
	Metadata         *ContentMetadata         `json:"metadata"`
	ValidationResult *ContentValidationResult `json:"validation_result"`
	TOC              *TableOfContents         `json:"toc"`
	WordCount        int                      `json:"word_count"`
	ReadTime         int                      `json:"read_time"` // in minutes
	ProcessedAt      time.Time                `json:"processed_at"`
	Duration         time.Duration            `json:"duration"`
}

// ContentValidationResult contains content validation results
type ContentValidationResult struct {
	IsValid     bool                       `json:"is_valid"`
	Errors      []ContentValidationError   `json:"errors"`
	Warnings    []ContentValidationWarning `json:"warnings"`
	Suggestions []ContentSuggestion        `json:"suggestions"`
}

// ContentValidationError represents a content validation error
type ContentValidationError struct {
	Code     string `json:"code"`
	Message  string `json:"message"`
	Line     int    `json:"line"`
	Column   int    `json:"column"`
	Severity string `json:"severity"`
}

// ContentValidationWarning represents a content validation warning
type ContentValidationWarning struct {
	Code       string `json:"code"`
	Message    string `json:"message"`
	Line       int    `json:"line"`
	Column     int    `json:"column"`
	Suggestion string `json:"suggestion"`
}

// ContentSuggestion represents a content improvement suggestion
type ContentSuggestion struct {
	Type       string `json:"type"` // style, readability, seo, accessibility
	Message    string `json:"message"`
	Suggestion string `json:"suggestion"`
	Priority   string `json:"priority"` // high, medium, low
}

// ContentMetadata contains extracted content metadata
type ContentMetadata struct {
	Title        string                 `json:"title"`
	Description  string                 `json:"description"`
	Keywords     []string               `json:"keywords"`
	Tags         []string               `json:"tags"`
	Categories   []string               `json:"categories"`
	Language     string                 `json:"language"`
	WordCount    int                    `json:"word_count"`
	ReadTime     int                    `json:"read_time"`
	Headings     []ContentHeading       `json:"headings"`
	Links        []ContentLink          `json:"links"`
	Images       []ContentImage         `json:"images"`
	CodeBlocks   []ContentCodeBlock     `json:"code_blocks"`
	CustomFields map[string]interface{} `json:"custom_fields"`
}

// ContentHeading represents a content heading
type ContentHeading struct {
	Level int    `json:"level"`
	Text  string `json:"text"`
	ID    string `json:"id"`
	Line  int    `json:"line"`
}

// ContentLink represents a content link
type ContentLink struct {
	Text string `json:"text"`
	URL  string `json:"url"`
	Type string `json:"type"` // internal, external, anchor
	Line int    `json:"line"`
}

// ContentImage represents a content image
type ContentImage struct {
	Alt    string `json:"alt"`
	URL    string `json:"url"`
	Title  string `json:"title"`
	Width  int    `json:"width"`
	Height int    `json:"height"`
	Line   int    `json:"line"`
}

// ContentCodeBlock represents a code block in content
type ContentCodeBlock struct {
	Language string `json:"language"`
	Code     string `json:"code"`
	Line     int    `json:"line"`
}

// TableOfContents represents a table of contents
type TableOfContents struct {
	Items []TOCItem `json:"items"`
}

// TOCItem represents a table of contents item
type TOCItem struct {
	Level    int       `json:"level"`
	Text     string    `json:"text"`
	ID       string    `json:"id"`
	Children []TOCItem `json:"children"`
}

// ContentConversionResult contains the result of format conversion
type ContentConversionResult struct {
	ConvertedContent string        `json:"converted_content"`
	FromFormat       ContentFormat `json:"from_format"`
	ToFormat         ContentFormat `json:"to_format"`
	Success          bool          `json:"success"`
	Errors           []string      `json:"errors"`
	Warnings         []string      `json:"warnings"`
}

// SearchRequest contains data for content search
type SearchRequest struct {
	Query       string        `json:"query" validate:"required"`
	WorkspaceID uuid.UUID     `json:"workspace_id" validate:"required"`
	SpaceIDs    []uuid.UUID   `json:"space_ids,omitempty"`
	Filters     SearchFilters `json:"filters"`
	Options     SearchOptions `json:"options"`
	UserID      uuid.UUID     `json:"user_id" validate:"required"`
}

// SearchFilters contains search filtering options
type SearchFilters struct {
	Status        []ArticleStatus `json:"status"`
	Format        []ContentFormat `json:"format"`
	Tags          []string        `json:"tags"`
	Categories    []string        `json:"categories"`
	CreatedAfter  *time.Time      `json:"created_after"`
	CreatedBefore *time.Time      `json:"created_before"`
	AuthorIDs     []uuid.UUID     `json:"author_ids"`
}

// SearchOptions contains search options
type SearchOptions struct {
	Limit          int      `json:"limit"`
	Offset         int      `json:"offset"`
	SortBy         string   `json:"sort_by"`    // relevance, date, title, views
	SortOrder      string   `json:"sort_order"` // asc, desc
	IncludeContent bool     `json:"include_content"`
	Highlight      bool     `json:"highlight"`
	FacetFields    []string `json:"facet_fields"`
}

// SearchResult contains search results
type SearchResult struct {
	Query       string                 `json:"query"`
	TotalHits   int64                  `json:"total_hits"`
	Results     []SearchResultItem     `json:"results"`
	Facets      map[string]SearchFacet `json:"facets"`
	Suggestions []SearchSuggestion     `json:"suggestions"`
	SearchedAt  time.Time              `json:"searched_at"`
	Duration    time.Duration          `json:"duration"`
}

// SearchResultItem represents a search result item
type SearchResultItem struct {
	Article      *domain.KnowledgeArticle `json:"article"`
	Score        float64                  `json:"score"`
	Highlights   map[string][]string      `json:"highlights"`
	MatchedTerms []string                 `json:"matched_terms"`
}

// SearchFacet represents search facets for filtering
type SearchFacet struct {
	Field  string             `json:"field"`
	Values []SearchFacetValue `json:"values"`
}

// SearchFacetValue represents a facet value
type SearchFacetValue struct {
	Value string `json:"value"`
	Count int64  `json:"count"`
}

// SearchSuggestion represents a search suggestion
type SearchSuggestion struct {
	Text  string  `json:"text"`
	Score float64 `json:"score"`
}

// SuggestionRequest contains data for suggestion requests
type SuggestionRequest struct {
	Partial     string      `json:"partial" validate:"required"`
	WorkspaceID uuid.UUID   `json:"workspace_id" validate:"required"`
	SpaceIDs    []uuid.UUID `json:"space_ids,omitempty"`
	Limit       int         `json:"limit"`
	UserID      uuid.UUID   `json:"user_id" validate:"required"`
}

// SuggestionResult contains suggestion results
type SuggestionResult struct {
	Suggestions []AutocompleteSuggestion `json:"suggestions"`
	Duration    time.Duration            `json:"duration"`
}

// AutocompleteSuggestion represents an autocomplete suggestion
type AutocompleteSuggestion struct {
	Text    string  `json:"text"`
	Type    string  `json:"type"` // article, tag, category
	Score   float64 `json:"score"`
	Context string  `json:"context"`
}

// Knowledge space related types

// KnowledgeCategory represents a knowledge category
type KnowledgeCategory struct {
	ID           uuid.UUID  `json:"id"`
	SpaceID      uuid.UUID  `json:"space_id"`
	Name         string     `json:"name"`
	Slug         string     `json:"slug"`
	Description  string     `json:"description"`
	Color        string     `json:"color"`
	Icon         string     `json:"icon"`
	ParentID     *uuid.UUID `json:"parent_id,omitempty"`
	SortOrder    int        `json:"sort_order"`
	ArticleCount int        `json:"article_count"`
	CreatedAt    time.Time  `json:"created_at"`
	UpdatedAt    time.Time  `json:"updated_at"`
}

// KnowledgeTag represents a knowledge tag
type KnowledgeTag struct {
	ID           uuid.UUID `json:"id"`
	SpaceID      uuid.UUID `json:"space_id"`
	Name         string    `json:"name"`
	Slug         string    `json:"slug"`
	Description  string    `json:"description"`
	Color        string    `json:"color"`
	ArticleCount int       `json:"article_count"`
	CreatedAt    time.Time `json:"created_at"`
	UpdatedAt    time.Time `json:"updated_at"`
}

// KnowledgeArticleReaction represents a user reaction to an article
type KnowledgeArticleReaction struct {
	ID        uuid.UUID    `json:"id"`
	ArticleID uuid.UUID    `json:"article_id"`
	UserID    uuid.UUID    `json:"user_id"`
	Type      ReactionType `json:"type"`
	CreatedAt time.Time    `json:"created_at"`
}

// Statistics types

// KnowledgeSpaceStats contains knowledge space statistics
type KnowledgeSpaceStats struct {
	TotalArticles     int                    `json:"total_articles"`
	PublishedArticles int                    `json:"published_articles"`
	DraftArticles     int                    `json:"draft_articles"`
	TotalViews        int64                  `json:"total_views"`
	UniqueViewers     int64                  `json:"unique_viewers"`
	TotalReactions    int64                  `json:"total_reactions"`
	AverageRating     float64                `json:"average_rating"`
	TopCategories     []CategoryStats        `json:"top_categories"`
	TopTags           []TagStats             `json:"top_tags"`
	TopAuthors        []AuthorStats          `json:"top_authors"`
	RecentActivity    []RecentActivity       `json:"recent_activity"`
	ContentMetrics    SpaceContentMetrics    `json:"content_metrics"`
	EngagementMetrics SpaceEngagementMetrics `json:"engagement_metrics"`
}

// KnowledgeArticleStats contains article statistics
type KnowledgeArticleStats struct {
	ViewCount         int64                  `json:"view_count"`
	UniqueViewers     int64                  `json:"unique_viewers"`
	ReactionCount     int64                  `json:"reaction_count"`
	BookmarkCount     int64                  `json:"bookmark_count"`
	ShareCount        int64                  `json:"share_count"`
	CommentCount      int64                  `json:"comment_count"`
	AverageRating     float64                `json:"average_rating"`
	ReadTime          int                    `json:"read_time"`
	LastViewedAt      *time.Time             `json:"last_viewed_at"`
	PopularityScore   float64                `json:"popularity_score"`
	ViewHistory       []ViewHistoryPoint     `json:"view_history"`
	ReactionBreakdown map[ReactionType]int64 `json:"reaction_breakdown"`
}

// CategoryStats represents category statistics
type CategoryStats struct {
	Category     *KnowledgeCategory `json:"category"`
	ArticleCount int                `json:"article_count"`
	ViewCount    int64              `json:"view_count"`
}

// TagStats represents tag statistics
type TagStats struct {
	Tag          *KnowledgeTag `json:"tag"`
	ArticleCount int           `json:"article_count"`
	ViewCount    int64         `json:"view_count"`
}

// AuthorStats represents author statistics
type AuthorStats struct {
	User          *domain.User `json:"user"`
	ArticleCount  int          `json:"article_count"`
	ViewCount     int64        `json:"view_count"`
	ReactionCount int64        `json:"reaction_count"`
}

// RecentActivity represents recent activity in a space
type RecentActivity struct {
	Type      string                   `json:"type"` // created, updated, published, viewed
	ArticleID uuid.UUID                `json:"article_id"`
	Article   *domain.KnowledgeArticle `json:"article,omitempty"`
	UserID    uuid.UUID                `json:"user_id"`
	User      *domain.User             `json:"user,omitempty"`
	Timestamp time.Time                `json:"timestamp"`
	Details   map[string]interface{}   `json:"details"`
}

// SpaceContentMetrics represents content metrics for a space
type SpaceContentMetrics struct {
	TotalWordCount       int                    `json:"total_word_count"`
	AverageWordCount     float64                `json:"average_word_count"`
	TotalReadTime        int                    `json:"total_read_time"`
	AverageReadTime      float64                `json:"average_read_time"`
	FormatDistribution   map[ContentFormat]int  `json:"format_distribution"`
	StatusDistribution   map[ArticleStatus]int  `json:"status_distribution"`
	CategoryDistribution map[string]int         `json:"category_distribution"`
	TagDistribution      map[string]int         `json:"tag_distribution"`
	PublishingTrends     []PublishingTrendPoint `json:"publishing_trends"`
}

// SpaceEngagementMetrics represents engagement metrics for a space
type SpaceEngagementMetrics struct {
	ViewsPerArticle     float64                    `json:"views_per_article"`
	ReactionsPerArticle float64                    `json:"reactions_per_article"`
	BookmarksPerArticle float64                    `json:"bookmarks_per_article"`
	SharesPerArticle    float64                    `json:"shares_per_article"`
	EngagementRate      float64                    `json:"engagement_rate"`
	ReturnVisitorRate   float64                    `json:"return_visitor_rate"`
	AverageTimeOnPage   time.Duration              `json:"average_time_on_page"`
	BounceRate          float64                    `json:"bounce_rate"`
	PopularContent      []*domain.KnowledgeArticle `json:"popular_content"`
	EngagementTrends    []EngagementTrendPoint     `json:"engagement_trends"`
}

// ViewHistoryPoint represents a point in view history
type ViewHistoryPoint struct {
	Date      time.Time `json:"date"`
	ViewCount int64     `json:"view_count"`
}

// PublishingTrendPoint represents a publishing trend data point
type PublishingTrendPoint struct {
	Date         time.Time `json:"date"`
	ArticleCount int       `json:"article_count"`
	WordCount    int       `json:"word_count"`
}

// EngagementTrendPoint represents an engagement trend data point
type EngagementTrendPoint struct {
	Date           time.Time `json:"date"`
	Views          int64     `json:"views"`
	Reactions      int64     `json:"reactions"`
	Bookmarks      int64     `json:"bookmarks"`
	Shares         int64     `json:"shares"`
	UniqueVisitors int64     `json:"unique_visitors"`
}

// KnowledgeSpaceService implements business logic for knowledge space operations
type KnowledgeSpaceService struct {
	knowledgeRepo    KnowledgeSpaceRepository
	workspaceRepo    WorkspaceRepository
	userRepo         UserRepository
	contentProcessor ContentProcessor
	searchEngine     SearchEngine
	eventPub         EventPublisher
	cache            CacheManager
	logger           *slog.Logger
}

// NewKnowledgeSpaceService creates a new knowledge space service instance
func NewKnowledgeSpaceService(
	knowledgeRepo KnowledgeSpaceRepository,
	workspaceRepo WorkspaceRepository,
	userRepo UserRepository,
	contentProcessor ContentProcessor,
	searchEngine SearchEngine,
	eventPub EventPublisher,
	cache CacheManager,
	logger *slog.Logger,
) *KnowledgeSpaceService {
	return &KnowledgeSpaceService{
		knowledgeRepo:    knowledgeRepo,
		workspaceRepo:    workspaceRepo,
		userRepo:         userRepo,
		contentProcessor: contentProcessor,
		searchEngine:     searchEngine,
		eventPub:         eventPub,
		cache:            cache,
		logger:           logger.With("service", "knowledge_space"),
	}
}

// CreateKnowledgeSpace creates a new knowledge space with validation
func (s *KnowledgeSpaceService) CreateKnowledgeSpace(ctx context.Context, req CreateKnowledgeSpaceRequest) (*domain.KnowledgeSpace, error) {
	s.logger.InfoContext(ctx, "Creating knowledge space",
		"name", req.Name, "workspace_id", req.WorkspaceID, "created_by", req.CreatedBy)

	// Validate the request
	if err := s.validateCreateKnowledgeSpaceRequest(ctx, req); err != nil {
		return nil, fmt.Errorf("validation failed: %w", err)
	}

	// Check workspace exists and user has permission
	workspace, err := s.workspaceRepo.GetByID(ctx, req.WorkspaceID)
	if err != nil {
		return nil, fmt.Errorf("failed to get workspace: %w", err)
	}

	if !s.canUserCreateKnowledgeSpace(ctx, workspace, req.CreatedBy) {
		return nil, domain.ErrInsufficientPermission
	}

	// Check knowledge space slug availability
	if exists, err := s.checkKnowledgeSpaceExists(ctx, req.WorkspaceID, req.Slug); err != nil {
		return nil, fmt.Errorf("failed to check space existence: %w", err)
	} else if exists {
		return nil, ErrKnowledgeSpaceExists
	}

	// Create the knowledge space domain object
	now := time.Now()
	space := &domain.KnowledgeSpace{
		ID:          uuid.New(),
		WorkspaceID: req.WorkspaceID,
		Name:        req.Name,
		Slug:        req.Slug,
		Description: req.Description,
		Visibility:  string(req.Visibility),
		Icon:        req.Icon,
		Color:       req.Color,
		Tags:        req.Tags,
		Categories:  req.Categories,
		CreatedAt:   now,
		UpdatedAt:   now,
		CreatedBy:   req.CreatedBy,
		UpdatedBy:   req.CreatedBy,
	}

	// Set default visibility if not provided
	if space.Visibility == "" {
		space.Visibility = string(SpaceVisibilityInternal)
	}

	// Persist the knowledge space
	if err := s.knowledgeRepo.Create(ctx, space); err != nil {
		return nil, fmt.Errorf("failed to create knowledge space: %w", err)
	}

	// Clear relevant caches
	s.clearKnowledgeSpaceListCaches(ctx, req.WorkspaceID)

	// TODO: Publish knowledge space created event when EventPublisher is updated

	s.logger.InfoContext(ctx, "Knowledge space created successfully",
		"space_id", space.ID, "name", space.Name)

	return space, nil
}

// CreateArticle creates a new knowledge article with content processing
func (s *KnowledgeSpaceService) CreateArticle(ctx context.Context, req CreateArticleRequest) (*domain.KnowledgeArticle, error) {
	s.logger.InfoContext(ctx, "Creating knowledge article",
		"title", req.Title, "space_id", req.SpaceID, "created_by", req.CreatedBy)

	// Validate the request
	if err := s.validateCreateArticleRequest(ctx, req); err != nil {
		return nil, fmt.Errorf("validation failed: %w", err)
	}

	// Get the knowledge space
	space, err := s.knowledgeRepo.GetByID(ctx, req.SpaceID)
	if err != nil {
		return nil, fmt.Errorf("failed to get knowledge space: %w", err)
	}

	// Check permissions
	if !s.canUserCreateArticle(ctx, space, req.CreatedBy) {
		return nil, domain.ErrInsufficientPermission
	}

	// Check article slug availability
	if exists, err := s.checkArticleExists(ctx, req.SpaceID, req.Slug); err != nil {
		return nil, fmt.Errorf("failed to check article existence: %w", err)
	} else if exists {
		return nil, ErrKnowledgeArticleExists
	}

	// Process content
	processingReq := &ContentProcessingRequest{
		Content: req.Content,
		Format:  req.Format,
		Options: ProcessingOptions{
			GenerateExcerpt: true,
			ExtractMetadata: true,
			ValidateContent: true,
			GenerateTOC:     true,
		},
		Context: ProcessingContext{
			WorkspaceID: space.WorkspaceID,
			SpaceID:     req.SpaceID,
			UserID:      req.CreatedBy,
		},
	}

	processingResult, err := s.contentProcessor.ProcessContent(ctx, processingReq)
	if err != nil {
		return nil, fmt.Errorf("failed to process content: %w", err)
	}

	// Create the article domain object
	now := time.Now()
	article := &domain.KnowledgeArticle{
		ID:              uuid.New(),
		SpaceID:         req.SpaceID,
		Title:           req.Title,
		Slug:            req.Slug,
		Content:         processingResult.ProcessedContent,
		OriginalContent: req.Content,
		Format:          string(req.Format),
		Summary:         req.Summary,
		Status:          string(req.Status),
		Tags:            req.Tags,
		Categories:      req.Categories,
		WordCount:       processingResult.WordCount,
		ReadTime:        processingResult.ReadTime,
		PublishAt:       req.PublishAt,
		CreatedAt:       now,
		UpdatedAt:       now,
		CreatedBy:       req.CreatedBy,
		UpdatedBy:       req.CreatedBy,
	}

	// Set default status if not provided
	if article.Status == "" {
		article.Status = string(ArticleStatusDraft)
	}

	// Use generated excerpt if summary not provided
	if article.Summary == "" && processingResult.Excerpt != "" {
		article.Summary = processingResult.Excerpt
	}

	// Create initial version
	initialVersion := &domain.KnowledgeArticleVersion{
		ID:              uuid.New(),
		ArticleID:       article.ID,
		Version:         "1.0.0",
		Content:         processingResult.ProcessedContent,
		OriginalContent: req.Content,
		ContentHash:     s.calculateContentHash(req.Content),
		ChangeNotes:     "Initial version",
		WordCount:       processingResult.WordCount,
		ReadTime:        processingResult.ReadTime,
		CreatedAt:       now,
		UpdatedAt:       now,
		CreatedBy:       req.CreatedBy,
	}

	// Persist the article
	if err := s.knowledgeRepo.CreateArticle(ctx, article); err != nil {
		return nil, fmt.Errorf("failed to create article: %w", err)
	}

	// Persist the initial version
	if err := s.knowledgeRepo.CreateArticleVersion(ctx, initialVersion); err != nil {
		return nil, fmt.Errorf("failed to create initial version: %w", err)
	}

	// Index article for search if published
	if article.Status == string(ArticleStatusPublished) {
		if err := s.searchEngine.IndexArticle(ctx, article); err != nil {
			s.logger.WarnContext(ctx, "Failed to index article", "error", err)
		}
	}

	// Clear relevant caches
	s.clearArticleListCaches(ctx, req.SpaceID)

	// TODO: Publish article created event when EventPublisher is updated

	s.logger.InfoContext(ctx, "Knowledge article created successfully",
		"article_id", article.ID, "title", article.Title)

	return article, nil
}

// SearchArticles performs content search across articles
func (s *KnowledgeSpaceService) SearchArticles(ctx context.Context, req SearchRequest) (*SearchResult, error) {
	s.logger.DebugContext(ctx, "Searching articles", "query", req.Query, "workspace_id", req.WorkspaceID)

	// Check workspace access
	workspace, err := s.workspaceRepo.GetByID(ctx, req.WorkspaceID)
	if err != nil {
		return nil, fmt.Errorf("failed to get workspace: %w", err)
	}

	if !s.canUserSearchContent(ctx, workspace, req.UserID) {
		return nil, domain.ErrInsufficientPermission
	}

	// Perform search
	result, err := s.searchEngine.Search(ctx, &req)
	if err != nil {
		return nil, fmt.Errorf("search failed: %w", err)
	}

	return result, nil
}

// Helper methods

// validateCreateKnowledgeSpaceRequest validates a create knowledge space request
func (s *KnowledgeSpaceService) validateCreateKnowledgeSpaceRequest(ctx context.Context, req CreateKnowledgeSpaceRequest) error {
	if req.Name == "" {
		return ErrInvalidKnowledgeSpaceName
	}

	if req.Slug == "" {
		return ErrInvalidKnowledgeSpaceSlug
	}

	if req.WorkspaceID == uuid.Nil {
		return ErrInvalidWorkspaceID
	}

	if req.CreatedBy == uuid.Nil {
		return ErrInvalidUserID
	}

	// Validate slug format
	if !s.isValidSlug(req.Slug) {
		return ErrInvalidKnowledgeSpaceSlug
	}

	return nil
}

// validateCreateArticleRequest validates a create article request
func (s *KnowledgeSpaceService) validateCreateArticleRequest(ctx context.Context, req CreateArticleRequest) error {
	if req.Title == "" {
		return ErrInvalidArticleTitle
	}

	if req.Slug == "" {
		return ErrInvalidArticleSlug
	}

	if req.Content == "" {
		return ErrInvalidArticleContent
	}

	if req.SpaceID == uuid.Nil {
		return ErrInvalidKnowledgeSpaceID
	}

	if req.CreatedBy == uuid.Nil {
		return ErrInvalidUserID
	}

	// Validate slug format
	if !s.isValidSlug(req.Slug) {
		return ErrInvalidArticleSlug
	}

	// Validate content format
	validFormats := []ContentFormat{
		ContentFormatMarkdown, ContentFormatHTML, ContentFormatPlainText,
		ContentFormatJSON, ContentFormatYAML, ContentFormatRichText, ContentFormatMDX,
	}
	isValidFormat := false
	for _, validFormat := range validFormats {
		if req.Format == validFormat {
			isValidFormat = true
			break
		}
	}
	if !isValidFormat {
		return ErrInvalidContentFormat
	}

	return nil
}

// checkKnowledgeSpaceExists checks if a knowledge space with the same slug exists
func (s *KnowledgeSpaceService) checkKnowledgeSpaceExists(ctx context.Context, workspaceID uuid.UUID, slug string) (bool, error) {
	existing, err := s.knowledgeRepo.GetBySlug(ctx, workspaceID, slug)
	if err != nil {
		return false, nil // Assume not found
	}
	return existing != nil, nil
}

// checkArticleExists checks if an article with the same slug exists
func (s *KnowledgeSpaceService) checkArticleExists(ctx context.Context, spaceID uuid.UUID, slug string) (bool, error) {
	existing, err := s.knowledgeRepo.GetArticleBySlug(ctx, spaceID, slug)
	if err != nil {
		return false, nil // Assume not found
	}
	return existing != nil, nil
}

// isValidSlug validates slug format
func (s *KnowledgeSpaceService) isValidSlug(slug string) bool {
	// Slug should contain only alphanumeric characters, hyphens, and underscores
	matched, _ := regexp.MatchString(`^[a-zA-Z0-9_-]+$`, slug)
	return matched && len(slug) >= 1 && len(slug) <= 100
}

// calculateContentHash calculates a hash of the content
func (s *KnowledgeSpaceService) calculateContentHash(content string) string {
	// Simplified hash calculation - use SHA256 in production
	return fmt.Sprintf("sha256-%x", len(content))
}

// Permission checking methods

func (s *KnowledgeSpaceService) canUserCreateKnowledgeSpace(ctx context.Context, workspace *domain.Workspace, userID uuid.UUID) bool {
	member := workspace.GetMember(userID)
	if member == nil {
		return false
	}

	return member.Role == domain.WorkspaceRoleOwner ||
		member.Role == domain.WorkspaceRoleAdmin ||
		member.Role == domain.WorkspaceRoleDeveloper
}

func (s *KnowledgeSpaceService) canUserCreateArticle(ctx context.Context, space *domain.KnowledgeSpace, userID uuid.UUID) bool {
	// Space creator can create articles
	if space.CreatedBy == userID {
		return true
	}

	// Check workspace permissions
	workspace, err := s.workspaceRepo.GetByID(ctx, space.WorkspaceID)
	if err != nil {
		return false
	}

	member := workspace.GetMember(userID)
	if member == nil {
		return false
	}

	return member.Role == domain.WorkspaceRoleOwner ||
		member.Role == domain.WorkspaceRoleAdmin ||
		member.Role == domain.WorkspaceRoleDeveloper
}

func (s *KnowledgeSpaceService) canUserSearchContent(ctx context.Context, workspace *domain.Workspace, userID uuid.UUID) bool {
	return workspace.HasMember(userID)
}

// Cache management

func (s *KnowledgeSpaceService) clearKnowledgeSpaceListCaches(ctx context.Context, workspaceID uuid.UUID) {
	patterns := []string{
		fmt.Sprintf("workspace:knowledge_spaces:%s", workspaceID.String()),
		"knowledge_spaces:list:*",
	}

	for _, pattern := range patterns {
		if err := s.cache.DeleteByPattern(ctx, pattern); err != nil {
			s.logger.WarnContext(ctx, "Failed to clear cache", "pattern", pattern, "error", err)
		}
	}
}

func (s *KnowledgeSpaceService) clearArticleListCaches(ctx context.Context, spaceID uuid.UUID) {
	patterns := []string{
		fmt.Sprintf("knowledge_space:articles:%s", spaceID.String()),
		"articles:list:*",
		"article_stats:*",
	}

	for _, pattern := range patterns {
		if err := s.cache.DeleteByPattern(ctx, pattern); err != nil {
			s.logger.WarnContext(ctx, "Failed to clear cache", "pattern", pattern, "error", err)
		}
	}
}

// Service-specific errors
var (
	ErrInvalidKnowledgeSpaceName = domain.NewDomainError("INVALID_KNOWLEDGE_SPACE_NAME", "Knowledge space name is invalid")
	ErrInvalidKnowledgeSpaceSlug = domain.NewDomainError("INVALID_KNOWLEDGE_SPACE_SLUG", "Knowledge space slug is invalid")
	ErrInvalidKnowledgeSpaceID   = domain.NewDomainError("INVALID_KNOWLEDGE_SPACE_ID", "Knowledge space ID is invalid")
	ErrInvalidArticleTitle       = domain.NewDomainError("INVALID_ARTICLE_TITLE", "Article title is invalid")
	ErrInvalidArticleSlug        = domain.NewDomainError("INVALID_ARTICLE_SLUG", "Article slug is invalid")
	ErrInvalidArticleContent     = domain.NewDomainError("INVALID_ARTICLE_CONTENT", "Article content is invalid")
	ErrInvalidContentFormat      = domain.NewDomainError("INVALID_CONTENT_FORMAT", "Content format is invalid")
	ErrKnowledgeSpaceExists      = domain.NewDomainError("KNOWLEDGE_SPACE_EXISTS", "Knowledge space already exists")
	ErrKnowledgeSpaceNotFound    = domain.NewDomainError("KNOWLEDGE_SPACE_NOT_FOUND", "Knowledge space not found")
	ErrKnowledgeArticleExists    = domain.NewDomainError("KNOWLEDGE_ARTICLE_EXISTS", "Knowledge article already exists")
	ErrKnowledgeArticleNotFound  = domain.NewDomainError("KNOWLEDGE_ARTICLE_NOT_FOUND", "Knowledge article not found")
	ErrContentProcessingFailed   = domain.NewDomainError("CONTENT_PROCESSING_FAILED", "Content processing failed")
	ErrSearchIndexingFailed      = domain.NewDomainError("SEARCH_INDEXING_FAILED", "Search indexing failed")
)
