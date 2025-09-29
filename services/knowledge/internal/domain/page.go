/**
 * T034 - Data Model: KnowledgePage with Content Management
 *
 * This model defines the knowledge page entity with content management,
 * versioning, collaboration, and comprehensive publishing workflow for
 * the Internal Developer Portal.
 *
 * Constitutional Requirements:
 * - Rich content management with multiple formats
 * - Version control and publishing workflow
 * - Collaborative editing and review process
 * - Full-text search and indexing
 * - Multi-tenant workspace isolation
 * - Integration with external content sources
 */

package domain

import (
	"regexp"
	"strings"
	"time"

	"github.com/google/uuid"
)

// PageStatus represents the lifecycle status of a page
type PageStatus string

const (
	PageStatusDraft     PageStatus = "draft"     // Work in progress
	PageStatusReview    PageStatus = "review"    // Under review
	PageStatusPublished PageStatus = "published" // Published and live
	PageStatusArchived  PageStatus = "archived"  // Archived but accessible
	PageStatusDeleted   PageStatus = "deleted"   // Soft deleted
)

// ContentType defines the format of page content
type ContentType string

const (
	ContentTypeMarkdown  ContentType = "markdown"  // Markdown format
	ContentTypeHTML      ContentType = "html"      // HTML format
	ContentTypeRichText  ContentType = "richtext"  // Rich text/WYSIWYG
	ContentTypePlainText ContentType = "plaintext" // Plain text
	ContentTypeJSON      ContentType = "json"      // Structured JSON content
)

// PageType classifies the purpose of the page
type PageType string

const (
	PageTypeDocument  PageType = "document"  // Regular documentation
	PageTypeTemplate  PageType = "template"  // Page template
	PageTypeAPI       PageType = "api"       // API documentation
	PageTypeTutorial  PageType = "tutorial"  // Tutorial/guide
	PageTypeReference PageType = "reference" // Reference material
	PageTypeFAQ       PageType = "faq"       // FAQ page
	PageTypeChangelog PageType = "changelog" // Changelog/release notes
	PageTypeReadme    PageType = "readme"    // README documentation
)

// ReviewDecision represents the outcome of a content review
type ReviewDecision string

const (
	ReviewApproved ReviewDecision = "approved" // Content approved
	ReviewRejected ReviewDecision = "rejected" // Content rejected
	ReviewChanges  ReviewDecision = "changes"  // Changes requested
	ReviewPending  ReviewDecision = "pending"  // Review pending
)

// CommentType defines the type of comment
type CommentType string

const (
	CommentGeneral    CommentType = "general"    // General comment
	CommentReview     CommentType = "review"     // Review feedback
	CommentQuestion   CommentType = "question"   // Question
	CommentSuggestion CommentType = "suggestion" // Improvement suggestion
)

// LinkType defines the type of page link
type LinkType string

const (
	LinkInternal   LinkType = "internal"   // Link to another page
	LinkExternal   LinkType = "external"   // External URL
	LinkRepository LinkType = "repository" // Repository link
	LinkAPI        LinkType = "api"        // API schema link
)

// AttachmentType defines the type of file attachment
type AttachmentType string

const (
	AttachmentImage    AttachmentType = "image"    // Image file
	AttachmentDocument AttachmentType = "document" // Document file
	AttachmentVideo    AttachmentType = "video"    // Video file
	AttachmentArchive  AttachmentType = "archive"  // Archive file
	AttachmentCode     AttachmentType = "code"     // Code file
)

// PageMetadata contains structured metadata about the page
type PageMetadata struct {
	// SEO and discovery
	Keywords   []string `json:"keywords" db:"keywords"`
	Category   string   `json:"category" db:"category"`
	Audience   []string `json:"audience" db:"audience"`
	Difficulty string   `json:"difficulty" db:"difficulty"` // beginner, intermediate, advanced

	// Content organization
	ReadingTime int `json:"reading_time" db:"reading_time"` // In minutes
	WordCount   int `json:"word_count" db:"word_count"`

	// External references
	SourceURL   string `json:"source_url" db:"source_url"`
	AuthorName  string `json:"author_name" db:"author_name"`
	AuthorEmail string `json:"author_email" db:"author_email"`

	// Content freshness
	ReviewDate *time.Time `json:"review_date" db:"review_date"`
	ExpiryDate *time.Time `json:"expiry_date" db:"expiry_date"`

	// Custom fields
	CustomFields map[string]interface{} `json:"custom_fields" db:"custom_fields"`
}

// PageVersion represents a version of page content
type PageVersion struct {
	ID            uuid.UUID `json:"id" db:"id"`
	PageID        uuid.UUID `json:"page_id" db:"page_id"`
	VersionNumber int       `json:"version_number" db:"version_number"`

	// Version content
	Title       string `json:"title" db:"title"`
	Content     string `json:"content" db:"content"`
	Summary     string `json:"summary" db:"summary"`
	ContentHash string `json:"content_hash" db:"content_hash"`

	// Change tracking
	ChangeMessage   string   `json:"change_message" db:"change_message"`
	ChangedSections []string `json:"changed_sections" db:"changed_sections"`

	// Version metadata
	IsMajorChange bool `json:"is_major_change" db:"is_major_change"`
	IsPublished   bool `json:"is_published" db:"is_published"`

	// Audit fields
	CreatedAt time.Time `json:"created_at" db:"created_at"`
	CreatedBy uuid.UUID `json:"created_by" db:"created_by"`
}

// PageLink represents a link from one page to another
type PageLink struct {
	ID           uuid.UUID `json:"id" db:"id"`
	SourcePageID uuid.UUID `json:"source_page_id" db:"source_page_id"`

	// Link target
	LinkType           LinkType   `json:"link_type" db:"link_type"`
	TargetPageID       *uuid.UUID `json:"target_page_id" db:"target_page_id"` // For internal links
	TargetURL          string     `json:"target_url" db:"target_url"`
	TargetRepositoryID *uuid.UUID `json:"target_repository_id" db:"target_repository_id"`
	TargetSchemaID     *uuid.UUID `json:"target_schema_id" db:"target_schema_id"`

	// Link metadata
	AnchorText string `json:"anchor_text" db:"anchor_text"`
	Position   int    `json:"position" db:"position"` // Position in content
	Context    string `json:"context" db:"context"`   // Surrounding text

	// Validation
	IsValidated   bool       `json:"is_validated" db:"is_validated"`
	IsBroken      bool       `json:"is_broken" db:"is_broken"`
	LastCheckedAt *time.Time `json:"last_checked_at" db:"last_checked_at"`

	// Audit fields
	CreatedAt time.Time `json:"created_at" db:"created_at"`
	UpdatedAt time.Time `json:"updated_at" db:"updated_at"`
}

// PageComment represents a comment on a page
type PageComment struct {
	ID     uuid.UUID `json:"id" db:"id"`
	PageID uuid.UUID `json:"page_id" db:"page_id"`

	// Comment hierarchy
	ParentCommentID *uuid.UUID `json:"parent_comment_id" db:"parent_comment_id"`
	ThreadID        uuid.UUID  `json:"thread_id" db:"thread_id"`

	// Comment content
	CommentType CommentType `json:"comment_type" db:"comment_type"`
	Content     string      `json:"content" db:"content"`

	// Position in content (for inline comments)
	ContentPosition *int   `json:"content_position" db:"content_position"`
	SelectedText    string `json:"selected_text" db:"selected_text"`

	// Status and resolution
	IsResolved bool       `json:"is_resolved" db:"is_resolved"`
	ResolvedAt *time.Time `json:"resolved_at" db:"resolved_at"`
	ResolvedBy *uuid.UUID `json:"resolved_by" db:"resolved_by"`

	// Replies (loaded separately)
	Replies []PageComment `json:"replies" db:"-"`

	// Audit fields
	CreatedAt time.Time `json:"created_at" db:"created_at"`
	UpdatedAt time.Time `json:"updated_at" db:"updated_at"`
	CreatedBy uuid.UUID `json:"created_by" db:"created_by"`
	UpdatedBy uuid.UUID `json:"updated_by" db:"updated_by"`
}

// PageAttachment represents a file attached to a page
type PageAttachment struct {
	ID     uuid.UUID `json:"id" db:"id"`
	PageID uuid.UUID `json:"page_id" db:"page_id"`

	// File details
	FileName       string         `json:"file_name" db:"file_name"`
	OriginalName   string         `json:"original_name" db:"original_name"`
	AttachmentType AttachmentType `json:"attachment_type" db:"attachment_type"`
	MimeType       string         `json:"mime_type" db:"mime_type"`
	FileSize       int64          `json:"file_size" db:"file_size"`

	// Storage
	StoragePath  string `json:"storage_path" db:"storage_path"`
	DownloadURL  string `json:"download_url" db:"download_url"`
	ThumbnailURL string `json:"thumbnail_url" db:"thumbnail_url"`

	// Usage in content
	IsEmbedded    bool   `json:"is_embedded" db:"is_embedded"`
	EmbedPosition *int   `json:"embed_position" db:"embed_position"`
	AltText       string `json:"alt_text" db:"alt_text"`

	// Access tracking
	DownloadCount int `json:"download_count" db:"download_count"`

	// Audit fields
	CreatedAt time.Time `json:"created_at" db:"created_at"`
	CreatedBy uuid.UUID `json:"created_by" db:"created_by"`
}

// PageReview represents a review workflow for a page
type PageReview struct {
	ID            uuid.UUID `json:"id" db:"id"`
	PageID        uuid.UUID `json:"page_id" db:"page_id"`
	PageVersionID uuid.UUID `json:"page_version_id" db:"page_version_id"`

	// Review details
	ReviewerID uuid.UUID      `json:"reviewer_id" db:"reviewer_id"`
	Decision   ReviewDecision `json:"decision" db:"decision"`
	Comments   string         `json:"comments" db:"comments"`

	// Review scope
	ReviewType       string   `json:"review_type" db:"review_type"` // content, technical, editorial
	ReviewedSections []string `json:"reviewed_sections" db:"reviewed_sections"`

	// Timeline
	RequestedAt time.Time  `json:"requested_at" db:"requested_at"`
	RequestedBy uuid.UUID  `json:"requested_by" db:"requested_by"`
	CompletedAt *time.Time `json:"completed_at" db:"completed_at"`

	// Review feedback
	Suggestions     []string `json:"suggestions" db:"suggestions"`
	RequiredChanges []string `json:"required_changes" db:"required_changes"`

	// Audit fields
	CreatedAt time.Time `json:"created_at" db:"created_at"`
	UpdatedAt time.Time `json:"updated_at" db:"updated_at"`
}

// PageAnalytics contains page usage and performance metrics
type PageAnalytics struct {
	PageID uuid.UUID `json:"page_id" db:"page_id"`

	// View metrics
	ViewCount     int     `json:"view_count" db:"view_count"`
	UniqueViewers int     `json:"unique_viewers" db:"unique_viewers"`
	AvgTimeOnPage float64 `json:"avg_time_on_page" db:"avg_time_on_page"`
	BounceRate    float64 `json:"bounce_rate" db:"bounce_rate"`

	// Engagement metrics
	CommentCount  int `json:"comment_count" db:"comment_count"`
	ShareCount    int `json:"share_count" db:"share_count"`
	BookmarkCount int `json:"bookmark_count" db:"bookmark_count"`

	// Search and discovery
	SearchImpressions  int      `json:"search_impressions" db:"search_impressions"`
	SearchClickthrough int      `json:"search_clickthrough" db:"search_clickthrough"`
	ReferrerPages      []string `json:"referrer_pages" db:"referrer_pages"`

	// Feedback
	UpvoteCount   int     `json:"upvote_count" db:"upvote_count"`
	DownvoteCount int     `json:"downvote_count" db:"downvote_count"`
	FeedbackScore float64 `json:"feedback_score" db:"feedback_score"`

	// Time period
	AnalyticsPeriod string    `json:"analytics_period" db:"analytics_period"`
	RecordedAt      time.Time `json:"recorded_at" db:"recorded_at"`
}

// KnowledgePage represents a knowledge page with content management
type KnowledgePage struct {
	// Core identity fields
	ID          uuid.UUID `json:"id" db:"id"`
	WorkspaceID uuid.UUID `json:"workspace_id" db:"workspace_id"`
	SpaceID     uuid.UUID `json:"space_id" db:"space_id"`

	// Basic information
	Title   string `json:"title" db:"title"`
	Slug    string `json:"slug" db:"slug"`
	Summary string `json:"summary" db:"summary"`

	// Content
	Content     string      `json:"content" db:"content"`
	ContentType ContentType `json:"content_type" db:"content_type"`
	ContentHash string      `json:"content_hash" db:"content_hash"`

	// Classification and organization
	PageType PageType `json:"page_type" db:"page_type"`
	Order    int      `json:"order" db:"order"`
	Path     string   `json:"path" db:"path"` // Full path within space

	// External source integration
	ContentSource ContentSource `json:"content_source" db:"content_source"`
	SourcePath    string        `json:"source_path" db:"source_path"`
	RepositoryID  *uuid.UUID    `json:"repository_id" db:"repository_id"`

	// Metadata and SEO
	Metadata PageMetadata `json:"metadata" db:"metadata"`
	Tags     []string     `json:"tags" db:"tags"`

	// Lifecycle and status
	Status PageStatus `json:"status" db:"status"`

	// Versioning
	CurrentVersion int           `json:"current_version" db:"current_version"`
	Versions       []PageVersion `json:"versions" db:"-"` // Loaded separately

	// Publishing
	PublishedAt *time.Time `json:"published_at" db:"published_at"`
	PublishedBy *uuid.UUID `json:"published_by" db:"published_by"`

	// Review workflow
	RequiresReview bool         `json:"requires_review" db:"requires_review"`
	LastReviewedAt *time.Time   `json:"last_reviewed_at" db:"last_reviewed_at"`
	Reviews        []PageReview `json:"reviews" db:"-"` // Loaded separately

	// Relationships (loaded separately)
	Links       []PageLink       `json:"links" db:"-"`
	Comments    []PageComment    `json:"comments" db:"-"`
	Attachments []PageAttachment `json:"attachments" db:"-"`

	// Usage tracking
	ViewCount    int        `json:"view_count" db:"view_count"`
	LastViewedAt *time.Time `json:"last_viewed_at" db:"last_viewed_at"`

	// Search and indexing
	SearchKeywords []string   `json:"search_keywords" db:"search_keywords"`
	IsIndexed      bool       `json:"is_indexed" db:"is_indexed"`
	LastIndexedAt  *time.Time `json:"last_indexed_at" db:"last_indexed_at"`

	// Analytics (loaded separately when needed)
	Analytics *PageAnalytics `json:"analytics" db:"-"`

	// Template information (if created from template)
	TemplateID      *uuid.UUID `json:"template_id" db:"template_id"`
	TemplateVersion string     `json:"template_version" db:"template_version"`

	// Audit trail fields
	CreatedAt time.Time  `json:"created_at" db:"created_at"`
	UpdatedAt time.Time  `json:"updated_at" db:"updated_at"`
	CreatedBy uuid.UUID  `json:"created_by" db:"created_by"`
	UpdatedBy uuid.UUID  `json:"updated_by" db:"updated_by"`
	DeletedAt *time.Time `json:"deleted_at" db:"deleted_at"` // Soft delete
}

// NewKnowledgePage creates a new knowledge page with required fields and defaults
func NewKnowledgePage(workspaceID, spaceID uuid.UUID, title, slug string, contentType ContentType, createdBy uuid.UUID) *KnowledgePage {
	now := time.Now()

	return &KnowledgePage{
		ID:             uuid.New(),
		WorkspaceID:    workspaceID,
		SpaceID:        spaceID,
		Title:          title,
		Slug:           slug,
		Summary:        "",
		Content:        "",
		ContentType:    contentType,
		ContentHash:    "",
		PageType:       PageTypeDocument, // Default type
		Order:          0,
		Path:           slug, // Will be updated based on space path
		ContentSource:  SourceManual,
		Tags:           []string{},
		Status:         PageStatusDraft,
		CurrentVersion: 1,
		Versions:       []PageVersion{},
		RequiresReview: false,
		Reviews:        []PageReview{},
		Links:          []PageLink{},
		Comments:       []PageComment{},
		Attachments:    []PageAttachment{},
		ViewCount:      0,
		SearchKeywords: []string{},
		IsIndexed:      false,
		Metadata:       getDefaultPageMetadata(),
		CreatedAt:      now,
		UpdatedAt:      now,
		CreatedBy:      createdBy,
		UpdatedBy:      createdBy,
	}
}

// getDefaultPageMetadata returns default metadata for a new page
func getDefaultPageMetadata() PageMetadata {
	return PageMetadata{
		Keywords:     []string{},
		Audience:     []string{},
		Difficulty:   "beginner",
		ReadingTime:  0,
		WordCount:    0,
		CustomFields: make(map[string]interface{}),
	}
}

// IsActive returns true if the page is not soft-deleted
func (p *KnowledgePage) IsActive() bool {
	return p.DeletedAt == nil && p.Status != PageStatusDeleted
}

// IsPublished returns true if the page is published
func (p *KnowledgePage) IsPublished() bool {
	return p.Status == PageStatusPublished
}

// IsDraft returns true if the page is in draft status
func (p *KnowledgePage) IsDraft() bool {
	return p.Status == PageStatusDraft
}

// IsUnderReview returns true if the page is under review
func (p *KnowledgePage) IsUnderReview() bool {
	return p.Status == PageStatusReview
}

// GetFullPath returns the complete hierarchical path including space
func (p *KnowledgePage) GetFullPath(space *KnowledgeSpace) string {
	if space == nil {
		return p.Path
	}
	return space.GetFullPath() + "/" + p.Slug
}

// CanUserAccess checks if a user has access to this page
func (p *KnowledgePage) CanUserAccess(userID uuid.UUID, spacePermission SpacePermission) bool {
	// Check if page is active
	if !p.IsActive() {
		return false
	}

	// Draft pages only visible to authors and editors
	if p.IsDraft() {
		return p.CreatedBy == userID || spacePermission == PermissionWrite ||
			spacePermission == PermissionMaintain || spacePermission == PermissionAdmin
	}

	// Pages under review visible to reviewers and admins
	if p.IsUnderReview() {
		return spacePermission == PermissionMaintain || spacePermission == PermissionAdmin ||
			p.CreatedBy == userID || p.hasUserAsReviewer(userID)
	}

	// Published pages visible based on space permission
	if p.IsPublished() {
		return spacePermission != PermissionNone
	}

	return false
}

// CanUserEdit checks if user can edit this page
func (p *KnowledgePage) CanUserEdit(userID uuid.UUID, spacePermission SpacePermission) bool {
	if !p.IsActive() {
		return false
	}

	// Check space permissions
	if spacePermission == PermissionWrite || spacePermission == PermissionMaintain || spacePermission == PermissionAdmin {
		return true
	}

	// Creator can always edit their own pages
	return p.CreatedBy == userID
}

// hasUserAsReviewer checks if user is assigned as a reviewer
func (p *KnowledgePage) hasUserAsReviewer(userID uuid.UUID) bool {
	for _, review := range p.Reviews {
		if review.ReviewerID == userID && review.CompletedAt == nil {
			return true
		}
	}
	return false
}

// UpdateContent updates the page content and creates a new version
func (p *KnowledgePage) UpdateContent(title, content, summary, changeMessage string, isMajorChange bool, updatedBy uuid.UUID) *PageVersion {
	now := time.Now()

	// Calculate content hash and word count
	contentHash := p.calculateContentHash(content)
	wordCount := p.calculateWordCount(content)
	readingTime := p.calculateReadingTime(wordCount)

	// Create new version
	version := &PageVersion{
		ID:              uuid.New(),
		PageID:          p.ID,
		VersionNumber:   p.CurrentVersion + 1,
		Title:           title,
		Content:         content,
		Summary:         summary,
		ContentHash:     contentHash,
		ChangeMessage:   changeMessage,
		ChangedSections: p.calculateChangedSections(p.Content, content),
		IsMajorChange:   isMajorChange,
		IsPublished:     false,
		CreatedAt:       now,
		CreatedBy:       updatedBy,
	}

	// Update page
	p.Title = title
	p.Content = content
	p.Summary = summary
	p.ContentHash = contentHash
	p.CurrentVersion = version.VersionNumber
	p.Metadata.WordCount = wordCount
	p.Metadata.ReadingTime = readingTime
	p.UpdatedAt = now
	p.UpdatedBy = updatedBy

	// Generate search keywords
	p.SearchKeywords = p.generateSearchKeywords(title, content)
	p.IsIndexed = false // Will need re-indexing

	// Add version to history
	p.Versions = append(p.Versions, *version)

	return version
}

// Publish publishes the page and optionally a specific version
func (p *KnowledgePage) Publish(versionNumber *int, publishedBy uuid.UUID) error {
	now := time.Now()

	// Validate that page can be published
	if !p.IsActive() {
		return ErrPageNotActive
	}

	if p.RequiresReview && !p.hasApprovedReview() {
		return ErrPageRequiresReview
	}

	// Find version to publish
	var versionToPublish *PageVersion
	targetVersion := p.CurrentVersion
	if versionNumber != nil {
		targetVersion = *versionNumber
	}

	for i, version := range p.Versions {
		if version.VersionNumber == targetVersion {
			versionToPublish = &p.Versions[i]
			break
		}
	}

	if versionToPublish == nil {
		return ErrVersionNotFound
	}

	// Update version
	versionToPublish.IsPublished = true

	// Update page
	p.Status = PageStatusPublished
	p.PublishedAt = &now
	p.PublishedBy = &publishedBy
	p.UpdatedAt = now
	p.UpdatedBy = publishedBy

	return nil
}

// hasApprovedReview checks if page has an approved review
func (p *KnowledgePage) hasApprovedReview() bool {
	for _, review := range p.Reviews {
		if review.Decision == ReviewApproved && review.CompletedAt != nil {
			return true
		}
	}
	return false
}

// Unpublish unpublishes the page
func (p *KnowledgePage) Unpublish(unpublishedBy uuid.UUID) {
	p.Status = PageStatusDraft
	p.PublishedAt = nil
	p.PublishedBy = nil
	p.UpdatedAt = time.Now()
	p.UpdatedBy = unpublishedBy
}

// Archive archives the page
func (p *KnowledgePage) Archive(archivedBy uuid.UUID) {
	p.Status = PageStatusArchived
	p.UpdatedAt = time.Now()
	p.UpdatedBy = archivedBy
}

// RequestReview requests a review for the page
func (p *KnowledgePage) RequestReview(reviewerID, requestedBy uuid.UUID, reviewType string, sections []string) *PageReview {
	now := time.Now()

	// Find current version
	var currentVersionID uuid.UUID
	for _, version := range p.Versions {
		if version.VersionNumber == p.CurrentVersion {
			currentVersionID = version.ID
			break
		}
	}

	review := &PageReview{
		ID:               uuid.New(),
		PageID:           p.ID,
		PageVersionID:    currentVersionID,
		ReviewerID:       reviewerID,
		Decision:         ReviewPending,
		ReviewType:       reviewType,
		ReviewedSections: sections,
		RequestedAt:      now,
		RequestedBy:      requestedBy,
		Suggestions:      []string{},
		RequiredChanges:  []string{},
		CreatedAt:        now,
		UpdatedAt:        now,
	}

	p.Reviews = append(p.Reviews, *review)
	p.Status = PageStatusReview
	p.UpdatedAt = now

	return review
}

// CompleteReview completes a review with decision and feedback
func (p *KnowledgePage) CompleteReview(reviewID uuid.UUID, decision ReviewDecision, comments string, suggestions, requiredChanges []string) error {
	now := time.Now()

	// Find the review
	for i, review := range p.Reviews {
		if review.ID == reviewID {
			p.Reviews[i].Decision = decision
			p.Reviews[i].Comments = comments
			p.Reviews[i].Suggestions = suggestions
			p.Reviews[i].RequiredChanges = requiredChanges
			p.Reviews[i].CompletedAt = &now
			p.Reviews[i].UpdatedAt = now

			// Update page review date
			p.LastReviewedAt = &now
			p.UpdatedAt = now

			// Update page status based on decision
			switch decision {
			case ReviewApproved:
				if p.Status == PageStatusReview {
					p.Status = PageStatusDraft // Can now be published
				}
			case ReviewRejected, ReviewChanges:
				p.Status = PageStatusDraft // Back to draft for changes
			}

			return nil
		}
	}

	return ErrReviewNotFound
}

// AddComment adds a comment to the page
func (p *KnowledgePage) AddComment(commentType CommentType, content string, parentCommentID *uuid.UUID, contentPosition *int, selectedText string, createdBy uuid.UUID) *PageComment {
	now := time.Now()

	// Generate thread ID for top-level comments or use parent's thread ID
	threadID := uuid.New()
	if parentCommentID != nil {
		for _, comment := range p.Comments {
			if comment.ID == *parentCommentID {
				threadID = comment.ThreadID
				break
			}
		}
	}

	comment := &PageComment{
		ID:              uuid.New(),
		PageID:          p.ID,
		ParentCommentID: parentCommentID,
		ThreadID:        threadID,
		CommentType:     commentType,
		Content:         content,
		ContentPosition: contentPosition,
		SelectedText:    selectedText,
		IsResolved:      false,
		Replies:         []PageComment{},
		CreatedAt:       now,
		UpdatedAt:       now,
		CreatedBy:       createdBy,
		UpdatedBy:       createdBy,
	}

	p.Comments = append(p.Comments, *comment)
	p.UpdatedAt = now

	return comment
}

// ResolveComment resolves a comment
func (p *KnowledgePage) ResolveComment(commentID, resolvedBy uuid.UUID) bool {
	now := time.Now()

	for i, comment := range p.Comments {
		if comment.ID == commentID {
			p.Comments[i].IsResolved = true
			p.Comments[i].ResolvedAt = &now
			p.Comments[i].ResolvedBy = &resolvedBy
			p.Comments[i].UpdatedAt = now
			p.UpdatedAt = now
			return true
		}
	}
	return false
}

// AddAttachment adds a file attachment to the page
func (p *KnowledgePage) AddAttachment(fileName, originalName string, attachmentType AttachmentType, mimeType string, fileSize int64, storagePath, downloadURL string, createdBy uuid.UUID) *PageAttachment {
	now := time.Now()

	attachment := &PageAttachment{
		ID:             uuid.New(),
		PageID:         p.ID,
		FileName:       fileName,
		OriginalName:   originalName,
		AttachmentType: attachmentType,
		MimeType:       mimeType,
		FileSize:       fileSize,
		StoragePath:    storagePath,
		DownloadURL:    downloadURL,
		IsEmbedded:     false,
		DownloadCount:  0,
		CreatedAt:      now,
		CreatedBy:      createdBy,
	}

	p.Attachments = append(p.Attachments, *attachment)
	p.UpdatedAt = now

	return attachment
}

// EmbedAttachment embeds an attachment in the content
func (p *KnowledgePage) EmbedAttachment(attachmentID uuid.UUID, position int, altText string) bool {
	for i, attachment := range p.Attachments {
		if attachment.ID == attachmentID {
			p.Attachments[i].IsEmbedded = true
			p.Attachments[i].EmbedPosition = &position
			p.Attachments[i].AltText = altText
			p.UpdatedAt = time.Now()
			return true
		}
	}
	return false
}

// AddLink adds a link from this page
func (p *KnowledgePage) AddLink(linkType LinkType, targetURL string, anchorText string, position int, targetPageID, targetRepositoryID, targetSchemaID *uuid.UUID) *PageLink {
	now := time.Now()

	link := &PageLink{
		ID:                 uuid.New(),
		SourcePageID:       p.ID,
		LinkType:           linkType,
		TargetPageID:       targetPageID,
		TargetURL:          targetURL,
		TargetRepositoryID: targetRepositoryID,
		TargetSchemaID:     targetSchemaID,
		AnchorText:         anchorText,
		Position:           position,
		IsValidated:        false,
		IsBroken:           false,
		CreatedAt:          now,
		UpdatedAt:          now,
	}

	p.Links = append(p.Links, *link)
	p.UpdatedAt = now

	return link
}

// IncrementViewCount increments the view counter
func (p *KnowledgePage) IncrementViewCount() {
	p.ViewCount++
	now := time.Now()
	p.LastViewedAt = &now
	p.UpdatedAt = now
}

// UpdateSearchIndex updates search indexing information
func (p *KnowledgePage) UpdateSearchIndex(indexed bool) {
	p.IsIndexed = indexed
	if indexed {
		now := time.Now()
		p.LastIndexedAt = &now
	}
	p.UpdatedAt = time.Now()
}

// GetCurrentVersion returns the current version of the page
func (p *KnowledgePage) GetCurrentVersion() *PageVersion {
	for _, version := range p.Versions {
		if version.VersionNumber == p.CurrentVersion {
			return &version
		}
	}
	return nil
}

// GetVersion returns a specific version by number
func (p *KnowledgePage) GetVersion(versionNumber int) *PageVersion {
	for _, version := range p.Versions {
		if version.VersionNumber == versionNumber {
			return &version
		}
	}
	return nil
}

// IsStale returns true if content hasn't been updated in 90 days
func (p *KnowledgePage) IsStale() bool {
	return time.Since(p.UpdatedAt) > 90*24*time.Hour
}

// GetActiveComments returns all unresolved comments
func (p *KnowledgePage) GetActiveComments() []PageComment {
	var active []PageComment
	for _, comment := range p.Comments {
		if !comment.IsResolved {
			active = append(active, comment)
		}
	}
	return active
}

// GetCommentsByType returns comments filtered by type
func (p *KnowledgePage) GetCommentsByType(commentType CommentType) []PageComment {
	var filtered []PageComment
	for _, comment := range p.Comments {
		if comment.CommentType == commentType {
			filtered = append(filtered, comment)
		}
	}
	return filtered
}

// calculateContentHash calculates a hash of the page content
func (p *KnowledgePage) calculateContentHash(content string) string {
	// Implementation would use a proper hash function like SHA256
	return "hash_" + content[:min(20, len(content))]
}

// calculateWordCount counts words in the content
func (p *KnowledgePage) calculateWordCount(content string) int {
	// Remove HTML tags and markdown formatting for accurate count
	text := stripMarkdown(content)
	words := strings.Fields(text)
	return len(words)
}

// calculateReadingTime estimates reading time in minutes (200 WPM average)
func (p *KnowledgePage) calculateReadingTime(wordCount int) int {
	if wordCount == 0 {
		return 0
	}
	minutes := wordCount / 200 // Average 200 words per minute
	if minutes == 0 {
		return 1 // Minimum 1 minute
	}
	return minutes
}

// calculateChangedSections identifies which sections changed between versions
func (p *KnowledgePage) calculateChangedSections(oldContent, newContent string) []string {
	// Simplified implementation - would use proper diff algorithm
	if oldContent == newContent {
		return []string{}
	}
	return []string{"content"} // Placeholder
}

// generateSearchKeywords extracts keywords for search indexing
func (p *KnowledgePage) generateSearchKeywords(title, content string) []string {
	text := strings.ToLower(title + " " + stripMarkdown(content))
	words := strings.Fields(text)

	// Remove common stop words and extract meaningful keywords
	keywords := make(map[string]bool)
	stopWords := map[string]bool{
		"the": true, "and": true, "or": true, "but": true, "in": true, "on": true,
		"at": true, "to": true, "for": true, "of": true, "with": true, "by": true,
		"is": true, "are": true, "was": true, "were": true, "be": true, "been": true,
		"have": true, "has": true, "had": true, "do": true, "does": true, "did": true,
		"a": true, "an": true, "this": true, "that": true, "these": true, "those": true,
	}

	for _, word := range words {
		cleaned := regexp.MustCompile(`[^a-z0-9]`).ReplaceAllString(word, "")
		if len(cleaned) > 3 && !stopWords[cleaned] {
			keywords[cleaned] = true
		}
	}

	// Convert to slice
	var result []string
	for keyword := range keywords {
		result = append(result, keyword)
		if len(result) >= 50 { // Limit to 50 keywords
			break
		}
	}

	return result
}

// stripMarkdown removes markdown formatting for text processing
func stripMarkdown(content string) string {
	// Remove markdown formatting - simplified implementation
	text := content

	// Remove headers
	text = regexp.MustCompile(`#{1,6}\s+`).ReplaceAllString(text, "")

	// Remove bold/italic
	text = regexp.MustCompile(`\*+([^*]+)\*+`).ReplaceAllString(text, "$1")
	text = regexp.MustCompile(`_+([^_]+)_+`).ReplaceAllString(text, "$1")

	// Remove links
	text = regexp.MustCompile(`\[([^\]]+)\]\([^)]+\)`).ReplaceAllString(text, "$1")

	// Remove code blocks
	text = regexp.MustCompile("```[^`]*```").ReplaceAllString(text, "")
	text = regexp.MustCompile("`[^`]+`").ReplaceAllString(text, "")

	return text
}

// min helper function
func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}

// Validate performs business logic validation on the page
func (p *KnowledgePage) Validate() error {
	if p.Title == "" {
		return ErrInvalidPageTitle
	}

	if p.Slug == "" {
		return ErrInvalidPageSlug
	}

	if p.WorkspaceID == uuid.Nil {
		return ErrInvalidWorkspaceID
	}

	if p.SpaceID == uuid.Nil {
		return ErrInvalidSpaceID
	}

	// Validate slug format
	if !isValidPageSlug(p.Slug) {
		return ErrInvalidPageSlug
	}

	// Validate content type
	switch p.ContentType {
	case ContentTypeMarkdown, ContentTypeHTML, ContentTypeRichText, ContentTypePlainText, ContentTypeJSON:
		// Valid types
	default:
		return ErrInvalidContentType
	}

	// Validate page type
	switch p.PageType {
	case PageTypeDocument, PageTypeTemplate, PageTypeAPI, PageTypeTutorial, PageTypeReference, PageTypeFAQ, PageTypeChangelog, PageTypeReadme:
		// Valid types
	default:
		return ErrInvalidPageType
	}

	return nil
}

// isValidPageSlug validates page slug format
func isValidPageSlug(slug string) bool {
	if len(slug) == 0 || len(slug) > 100 {
		return false
	}

	// Basic validation - alphanumeric, hyphens, underscores
	for _, char := range slug {
		if !((char >= 'a' && char <= 'z') ||
			(char >= 'A' && char <= 'Z') ||
			(char >= '0' && char <= '9') ||
			char == '-' || char == '_') {
			return false
		}
	}

	// Must not start or end with hyphen/underscore
	if strings.HasPrefix(slug, "-") || strings.HasPrefix(slug, "_") ||
		strings.HasSuffix(slug, "-") || strings.HasSuffix(slug, "_") {
		return false
	}

	return true
}

// ToPublicProfile returns a page profile safe for public consumption
func (p *KnowledgePage) ToPublicProfile() map[string]interface{} {
	profile := map[string]interface{}{
		"id":              p.ID,
		"title":           p.Title,
		"slug":            p.Slug,
		"summary":         p.Summary,
		"content_type":    p.ContentType,
		"page_type":       p.PageType,
		"status":          p.Status,
		"current_version": p.CurrentVersion,
		"view_count":      p.ViewCount,
		"created_at":      p.CreatedAt,
		"updated_at":      p.UpdatedAt,
	}

	// Add published info if published
	if p.IsPublished() && p.PublishedAt != nil {
		profile["published_at"] = *p.PublishedAt
	}

	// Add reading time if available
	if p.Metadata.ReadingTime > 0 {
		profile["reading_time"] = p.Metadata.ReadingTime
	}

	// Add tags if present
	if len(p.Tags) > 0 {
		profile["tags"] = p.Tags
	}

	return profile
}

// ToSearchResult returns a search result representation
func (p *KnowledgePage) ToSearchResult() map[string]interface{} {
	result := map[string]interface{}{
		"id":         p.ID,
		"title":      p.Title,
		"summary":    p.Summary,
		"path":       p.Path,
		"page_type":  p.PageType,
		"updated_at": p.UpdatedAt,
		"view_count": p.ViewCount,
	}

	// Add content excerpt (first 200 characters)
	if len(p.Content) > 0 {
		excerpt := stripMarkdown(p.Content)
		if len(excerpt) > 200 {
			excerpt = excerpt[:200] + "..."
		}
		result["excerpt"] = excerpt
	}

	return result
}

// Domain errors for knowledge page operations
var (
	ErrInvalidPageTitle   = NewDomainError("INVALID_PAGE_TITLE", "Page title is required and must be valid")
	ErrInvalidPageSlug    = NewDomainError("INVALID_PAGE_SLUG", "Page slug is required and must be valid")
	ErrInvalidContentType = NewDomainError("INVALID_CONTENT_TYPE", "Content type is invalid")
	ErrInvalidPageType    = NewDomainError("INVALID_PAGE_TYPE", "Page type is invalid")
	ErrInvalidSpaceID     = NewDomainError("INVALID_SPACE_ID", "Space ID is required")
	ErrPageNotFound       = NewDomainError("PAGE_NOT_FOUND", "Knowledge page not found")
	ErrPageExists         = NewDomainError("PAGE_EXISTS", "Knowledge page already exists")
	ErrPageNotActive      = NewDomainError("PAGE_NOT_ACTIVE", "Page is not active")
	ErrPageRequiresReview = NewDomainError("PAGE_REQUIRES_REVIEW", "Page requires review before publishing")
	ErrVersionNotFound    = NewDomainError("VERSION_NOT_FOUND", "Page version not found")
	ErrReviewNotFound     = NewDomainError("REVIEW_NOT_FOUND", "Page review not found")
	ErrCommentNotFound    = NewDomainError("COMMENT_NOT_FOUND", "Page comment not found")
	ErrAttachmentNotFound = NewDomainError("ATTACHMENT_NOT_FOUND", "Page attachment not found")
	ErrInvalidReview      = NewDomainError("INVALID_REVIEW", "Review data is invalid")
	ErrReviewCompleted    = NewDomainError("REVIEW_COMPLETED", "Review has already been completed")
	ErrPageArchived       = NewDomainError("PAGE_ARCHIVED", "Page is archived")
)
