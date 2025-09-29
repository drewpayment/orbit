/**
 * Knowledge Space Domain Models for Repository Service
 *
 * This file contains domain models for knowledge management including:
 * - KnowledgeSpace: Knowledge space entity with settings and metadata
 * - KnowledgeArticle: Knowledge article with content and versioning
 * - KnowledgeArticleVersion: Individual article versions with content and metrics
 *
 * Constitutional Requirements:
 * - Rich domain models with business logic
 * - Multi-format content support (Markdown, HTML, structured data)
 * - Version management and collaboration features
 * - Multi-tenant workspace isolation
 * - Comprehensive metadata and audit trails
 */

package domain

import (
	"time"

	"github.com/google/uuid"
)

// KnowledgeSpace represents a knowledge space entity in the system
type KnowledgeSpace struct {
	ID               uuid.UUID  `json:"id" db:"id"`
	WorkspaceID      uuid.UUID  `json:"workspace_id" db:"workspace_id"`
	Name             string     `json:"name" db:"name"`
	Slug             string     `json:"slug" db:"slug"`
	Description      string     `json:"description" db:"description"`
	Visibility       string     `json:"visibility" db:"visibility"` // private, internal, public
	Icon             string     `json:"icon" db:"icon"`
	Color            string     `json:"color" db:"color"`
	Tags             []string   `json:"tags" db:"tags"`
	Categories       []string   `json:"categories" db:"categories"`
	ArticleCount     int        `json:"article_count" db:"article_count"`
	PublishedCount   int        `json:"published_count" db:"published_count"`
	DraftCount       int        `json:"draft_count" db:"draft_count"`
	ViewCount        int64      `json:"view_count" db:"view_count"`
	ContributorCount int        `json:"contributor_count" db:"contributor_count"`
	LastActivityAt   *time.Time `json:"last_activity_at" db:"last_activity_at"`
	CreatedAt        time.Time  `json:"created_at" db:"created_at"`
	UpdatedAt        time.Time  `json:"updated_at" db:"updated_at"`
	CreatedBy        uuid.UUID  `json:"created_by" db:"created_by"`
	UpdatedBy        uuid.UUID  `json:"updated_by" db:"updated_by"`

	// Computed/loaded fields
	Workspace       *Workspace          `json:"workspace,omitempty" db:"-"`
	Creator         *User               `json:"creator,omitempty" db:"-"`
	Updater         *User               `json:"updater,omitempty" db:"-"`
	Articles        []*KnowledgeArticle `json:"articles,omitempty" db:"-"`
	RecentArticles  []*KnowledgeArticle `json:"recent_articles,omitempty" db:"-"`
	PopularArticles []*KnowledgeArticle `json:"popular_articles,omitempty" db:"-"`
	Contributors    []*User             `json:"contributors,omitempty" db:"-"`
}

// KnowledgeArticle represents a knowledge article entity
type KnowledgeArticle struct {
	ID              uuid.UUID  `json:"id" db:"id"`
	SpaceID         uuid.UUID  `json:"space_id" db:"space_id"`
	Title           string     `json:"title" db:"title"`
	Slug            string     `json:"slug" db:"slug"`
	Content         string     `json:"content" db:"content"`
	OriginalContent string     `json:"original_content" db:"original_content"`
	Format          string     `json:"format" db:"format"` // markdown, html, plain_text, json, yaml, rich_text, mdx
	Summary         string     `json:"summary" db:"summary"`
	Status          string     `json:"status" db:"status"` // draft, review, approved, published, archived, deleted
	Tags            []string   `json:"tags" db:"tags"`
	Categories      []string   `json:"categories" db:"categories"`
	WordCount       int        `json:"word_count" db:"word_count"`
	ReadTime        int        `json:"read_time" db:"read_time"` // in minutes
	ViewCount       int64      `json:"view_count" db:"view_count"`
	ReactionCount   int64      `json:"reaction_count" db:"reaction_count"`
	BookmarkCount   int64      `json:"bookmark_count" db:"bookmark_count"`
	ShareCount      int64      `json:"share_count" db:"share_count"`
	CommentCount    int64      `json:"comment_count" db:"comment_count"`
	Rating          float64    `json:"rating" db:"rating"`
	RatingCount     int64      `json:"rating_count" db:"rating_count"`
	PopularityScore float64    `json:"popularity_score" db:"popularity_score"`
	CurrentVersion  string     `json:"current_version" db:"current_version"`
	VersionCount    int        `json:"version_count" db:"version_count"`
	IsTemplate      bool       `json:"is_template" db:"is_template"`
	IsFeatured      bool       `json:"is_featured" db:"is_featured"`
	IsPinned        bool       `json:"is_pinned" db:"is_pinned"`
	SortOrder       int        `json:"sort_order" db:"sort_order"`
	PublishAt       *time.Time `json:"publish_at" db:"publish_at"`
	PublishedAt     *time.Time `json:"published_at" db:"published_at"`
	LastViewedAt    *time.Time `json:"last_viewed_at" db:"last_viewed_at"`
	CreatedAt       time.Time  `json:"created_at" db:"created_at"`
	UpdatedAt       time.Time  `json:"updated_at" db:"updated_at"`
	CreatedBy       uuid.UUID  `json:"created_by" db:"created_by"`
	UpdatedBy       uuid.UUID  `json:"updated_by" db:"updated_by"`

	// Computed/loaded fields
	Space             *KnowledgeSpace            `json:"space,omitempty" db:"-"`
	Creator           *User                      `json:"creator,omitempty" db:"-"`
	Updater           *User                      `json:"updater,omitempty" db:"-"`
	CurrentVersionObj *KnowledgeArticleVersion   `json:"current_version_obj,omitempty" db:"-"`
	Versions          []*KnowledgeArticleVersion `json:"versions,omitempty" db:"-"`
	Reactions         []*ArticleReaction         `json:"reactions,omitempty" db:"-"`
	Comments          []*ArticleComment          `json:"comments,omitempty" db:"-"`
}

// KnowledgeArticleVersion represents a version of a knowledge article
type KnowledgeArticleVersion struct {
	ID              uuid.UUID  `json:"id" db:"id"`
	ArticleID       uuid.UUID  `json:"article_id" db:"article_id"`
	Version         string     `json:"version" db:"version"`
	Content         string     `json:"content" db:"content"`
	OriginalContent string     `json:"original_content" db:"original_content"`
	ContentHash     string     `json:"content_hash" db:"content_hash"`
	ContentSize     int64      `json:"content_size" db:"content_size"`
	ChangeNotes     string     `json:"change_notes" db:"change_notes"`
	IsPublished     bool       `json:"is_published" db:"is_published"`
	IsCurrent       bool       `json:"is_current" db:"is_current"`
	IsMinor         bool       `json:"is_minor" db:"is_minor"`
	WordCount       int        `json:"word_count" db:"word_count"`
	ReadTime        int        `json:"read_time" db:"read_time"`
	PublishedAt     *time.Time `json:"published_at" db:"published_at"`
	CreatedAt       time.Time  `json:"created_at" db:"created_at"`
	UpdatedAt       time.Time  `json:"updated_at" db:"updated_at"`
	CreatedBy       uuid.UUID  `json:"created_by" db:"created_by"`

	// Computed/loaded fields
	Article        *KnowledgeArticle      `json:"article,omitempty" db:"-"`
	Creator        *User                  `json:"creator,omitempty" db:"-"`
	ChangesSummary *ArticleChangesSummary `json:"changes_summary,omitempty" db:"-"`
}

// ArticleReaction represents a user reaction to an article
type ArticleReaction struct {
	ID        uuid.UUID `json:"id" db:"id"`
	ArticleID uuid.UUID `json:"article_id" db:"article_id"`
	UserID    uuid.UUID `json:"user_id" db:"user_id"`
	Type      string    `json:"type" db:"type"` // like, dislike, helpful, not_helpful, bookmark, share
	CreatedAt time.Time `json:"created_at" db:"created_at"`

	// Computed/loaded fields
	User *User `json:"user,omitempty" db:"-"`
}

// ArticleComment represents a comment on an article
type ArticleComment struct {
	ID        uuid.UUID  `json:"id" db:"id"`
	ArticleID uuid.UUID  `json:"article_id" db:"article_id"`
	UserID    uuid.UUID  `json:"user_id" db:"user_id"`
	ParentID  *uuid.UUID `json:"parent_id" db:"parent_id"`
	Content   string     `json:"content" db:"content"`
	Format    string     `json:"format" db:"format"`
	Status    string     `json:"status" db:"status"` // active, edited, deleted, flagged
	CreatedAt time.Time  `json:"created_at" db:"created_at"`
	UpdatedAt time.Time  `json:"updated_at" db:"updated_at"`

	// Computed/loaded fields
	User    *User             `json:"user,omitempty" db:"-"`
	Parent  *ArticleComment   `json:"parent,omitempty" db:"-"`
	Replies []*ArticleComment `json:"replies,omitempty" db:"-"`
}

// ArticleChangesSummary provides a summary of changes between versions
type ArticleChangesSummary struct {
	TotalChanges      int      `json:"total_changes"`
	AddedLines        int      `json:"added_lines"`
	RemovedLines      int      `json:"removed_lines"`
	ModifiedSections  []string `json:"modified_sections"`
	ChangeDescription string   `json:"change_description"`
	ImpactLevel       string   `json:"impact_level"` // minor, moderate, major
}

// Business Logic Methods for KnowledgeSpace

// IsPublic returns true if the knowledge space has public visibility
func (ks *KnowledgeSpace) IsPublic() bool {
	return ks.Visibility == "public"
}

// IsInternal returns true if the knowledge space has internal visibility
func (ks *KnowledgeSpace) IsInternal() bool {
	return ks.Visibility == "internal"
}

// IsPrivate returns true if the knowledge space has private visibility
func (ks *KnowledgeSpace) IsPrivate() bool {
	return ks.Visibility == "private"
}

// HasRecentActivity returns true if there was activity in the last 30 days
func (ks *KnowledgeSpace) HasRecentActivity() bool {
	if ks.LastActivityAt == nil {
		return false
	}
	return time.Since(*ks.LastActivityAt) <= 30*24*time.Hour
}

// GetEngagementScore calculates an engagement score based on views and articles
func (ks *KnowledgeSpace) GetEngagementScore() float64 {
	if ks.ArticleCount == 0 {
		return 0
	}
	return float64(ks.ViewCount) / float64(ks.ArticleCount)
}

// HasTag returns true if the knowledge space has the specified tag
func (ks *KnowledgeSpace) HasTag(tag string) bool {
	for _, t := range ks.Tags {
		if t == tag {
			return true
		}
	}
	return false
}

// HasCategory returns true if the knowledge space has the specified category
func (ks *KnowledgeSpace) HasCategory(category string) bool {
	for _, c := range ks.Categories {
		if c == category {
			return true
		}
	}
	return false
}

// AddTag adds a tag if it doesn't already exist
func (ks *KnowledgeSpace) AddTag(tag string) {
	if !ks.HasTag(tag) {
		ks.Tags = append(ks.Tags, tag)
	}
}

// RemoveTag removes a tag if it exists
func (ks *KnowledgeSpace) RemoveTag(tag string) {
	for i, t := range ks.Tags {
		if t == tag {
			ks.Tags = append(ks.Tags[:i], ks.Tags[i+1:]...)
			break
		}
	}
}

// AddCategory adds a category if it doesn't already exist
func (ks *KnowledgeSpace) AddCategory(category string) {
	if !ks.HasCategory(category) {
		ks.Categories = append(ks.Categories, category)
	}
}

// RemoveCategory removes a category if it exists
func (ks *KnowledgeSpace) RemoveCategory(category string) {
	for i, c := range ks.Categories {
		if c == category {
			ks.Categories = append(ks.Categories[:i], ks.Categories[i+1:]...)
			break
		}
	}
}

// CanBeAccessedBy returns true if the user can access this knowledge space
func (ks *KnowledgeSpace) CanBeAccessedBy(userID uuid.UUID, workspace *Workspace) bool {
	// Knowledge space creator can access
	if ks.CreatedBy == userID {
		return true
	}

	// Check visibility and workspace membership
	if workspace == nil {
		return false
	}

	switch ks.Visibility {
	case "public":
		return workspace.HasMember(userID)
	case "internal":
		return workspace.HasMember(userID)
	case "private":
		return ks.CreatedBy == userID
	default:
		return false
	}
}

// CanBeModifiedBy returns true if the user can modify this knowledge space
func (ks *KnowledgeSpace) CanBeModifiedBy(userID uuid.UUID, workspace *Workspace) bool {
	// Knowledge space creator can modify
	if ks.CreatedBy == userID {
		return true
	}

	// Check workspace permissions
	if workspace == nil {
		return false
	}

	member := workspace.GetMember(userID)
	if member == nil {
		return false
	}

	return member.Role == WorkspaceRoleOwner ||
		member.Role == WorkspaceRoleAdmin
}

// Business Logic Methods for KnowledgeArticle

// IsPublished returns true if the article is published
func (ka *KnowledgeArticle) IsPublished() bool {
	return ka.Status == "published"
}

// IsDraft returns true if the article is in draft status
func (ka *KnowledgeArticle) IsDraft() bool {
	return ka.Status == "draft"
}

// IsInReview returns true if the article is in review status
func (ka *KnowledgeArticle) IsInReview() bool {
	return ka.Status == "review"
}

// IsArchived returns true if the article is archived
func (ka *KnowledgeArticle) IsArchived() bool {
	return ka.Status == "archived"
}

// IsDeleted returns true if the article is deleted
func (ka *KnowledgeArticle) IsDeleted() bool {
	return ka.Status == "deleted"
}

// IsScheduledForPublishing returns true if the article is scheduled for future publishing
func (ka *KnowledgeArticle) IsScheduledForPublishing() bool {
	return ka.PublishAt != nil && ka.PublishAt.After(time.Now()) && !ka.IsPublished()
}

// GetEngagementRate calculates the engagement rate based on reactions and views
func (ka *KnowledgeArticle) GetEngagementRate() float64 {
	if ka.ViewCount == 0 {
		return 0
	}
	totalEngagement := ka.ReactionCount + ka.BookmarkCount + ka.ShareCount + ka.CommentCount
	return float64(totalEngagement) / float64(ka.ViewCount) * 100
}

// GetQualityScore calculates a quality score based on various metrics
func (ka *KnowledgeArticle) GetQualityScore() float64 {
	score := 0.0

	// Base score for having content
	if ka.WordCount > 0 {
		score += 20
	}

	// Score for word count (optimal range: 300-2000 words)
	if ka.WordCount >= 300 && ka.WordCount <= 2000 {
		score += 30
	} else if ka.WordCount > 100 {
		score += 15
	}

	// Score for having summary
	if ka.Summary != "" {
		score += 10
	}

	// Score for having tags
	if len(ka.Tags) > 0 {
		score += 10
	}

	// Score for having categories
	if len(ka.Categories) > 0 {
		score += 10
	}

	// Score for engagement
	engagementRate := ka.GetEngagementRate()
	if engagementRate > 10 {
		score += 20
	} else if engagementRate > 5 {
		score += 10
	}

	return score
}

// HasTag returns true if the article has the specified tag
func (ka *KnowledgeArticle) HasTag(tag string) bool {
	for _, t := range ka.Tags {
		if t == tag {
			return true
		}
	}
	return false
}

// HasCategory returns true if the article has the specified category
func (ka *KnowledgeArticle) HasCategory(category string) bool {
	for _, c := range ka.Categories {
		if c == category {
			return true
		}
	}
	return false
}

// AddTag adds a tag if it doesn't already exist
func (ka *KnowledgeArticle) AddTag(tag string) {
	if !ka.HasTag(tag) {
		ka.Tags = append(ka.Tags, tag)
	}
}

// RemoveTag removes a tag if it exists
func (ka *KnowledgeArticle) RemoveTag(tag string) {
	for i, t := range ka.Tags {
		if t == tag {
			ka.Tags = append(ka.Tags[:i], ka.Tags[i+1:]...)
			break
		}
	}
}

// AddCategory adds a category if it doesn't already exist
func (ka *KnowledgeArticle) AddCategory(category string) {
	if !ka.HasCategory(category) {
		ka.Categories = append(ka.Categories, category)
	}
}

// RemoveCategory removes a category if it exists
func (ka *KnowledgeArticle) RemoveCategory(category string) {
	for i, c := range ka.Categories {
		if c == category {
			ka.Categories = append(ka.Categories[:i], ka.Categories[i+1:]...)
			break
		}
	}
}

// CanBeAccessedBy returns true if the user can access this article
func (ka *KnowledgeArticle) CanBeAccessedBy(userID uuid.UUID, space *KnowledgeSpace, workspace *Workspace) bool {
	// Article creator can access
	if ka.CreatedBy == userID {
		return true
	}

	// Only published articles are publicly accessible (unless you're the creator)
	if !ka.IsPublished() {
		return ka.CreatedBy == userID
	}

	// Check knowledge space access
	return space.CanBeAccessedBy(userID, workspace)
}

// CanBeModifiedBy returns true if the user can modify this article
func (ka *KnowledgeArticle) CanBeModifiedBy(userID uuid.UUID, space *KnowledgeSpace, workspace *Workspace) bool {
	// Article creator can modify
	if ka.CreatedBy == userID {
		return true
	}

	// Check knowledge space modification permissions
	return space.CanBeModifiedBy(userID, workspace)
}

// CanBeDeletedBy returns true if the user can delete this article
func (ka *KnowledgeArticle) CanBeDeletedBy(userID uuid.UUID, space *KnowledgeSpace, workspace *Workspace) bool {
	// Article creator can delete
	if ka.CreatedBy == userID {
		return true
	}

	// Check workspace permissions
	if workspace == nil {
		return false
	}

	member := workspace.GetMember(userID)
	if member == nil {
		return false
	}

	return member.Role == WorkspaceRoleOwner ||
		member.Role == WorkspaceRoleAdmin
}

// Business Logic Methods for KnowledgeArticleVersion

// IsCurrentVersion returns true if this is the current version of the article
func (kav *KnowledgeArticleVersion) IsCurrentVersion() bool {
	return kav.IsCurrent
}

// IsMinorVersion returns true if this is a minor version change
func (kav *KnowledgeArticleVersion) IsMinorVersion() bool {
	return kav.IsMinor
}

// GetContentDelta calculates the content difference from the original
func (kav *KnowledgeArticleVersion) GetContentDelta() int {
	return len(kav.Content) - len(kav.OriginalContent)
}

// Business Logic Methods for ArticleReaction

// IsPositiveReaction returns true if the reaction is positive
func (ar *ArticleReaction) IsPositiveReaction() bool {
	return ar.Type == "like" || ar.Type == "helpful" || ar.Type == "bookmark"
}

// IsNegativeReaction returns true if the reaction is negative
func (ar *ArticleReaction) IsNegativeReaction() bool {
	return ar.Type == "dislike" || ar.Type == "not_helpful"
}

// Business Logic Methods for ArticleComment

// IsReply returns true if this comment is a reply to another comment
func (ac *ArticleComment) IsReply() bool {
	return ac.ParentID != nil
}

// IsTopLevel returns true if this comment is not a reply
func (ac *ArticleComment) IsTopLevel() bool {
	return ac.ParentID == nil
}

// IsActive returns true if the comment is active
func (ac *ArticleComment) IsActive() bool {
	return ac.Status == "active"
}

// IsDeleted returns true if the comment is deleted
func (ac *ArticleComment) IsDeleted() bool {
	return ac.Status == "deleted"
}

// IsFlagged returns true if the comment is flagged
func (ac *ArticleComment) IsFlagged() bool {
	return ac.Status == "flagged"
}

// CanBeModifiedBy returns true if the user can modify this comment
func (ac *ArticleComment) CanBeModifiedBy(userID uuid.UUID, workspace *Workspace) bool {
	// Comment creator can modify
	if ac.UserID == userID {
		return true
	}

	// Check workspace permissions
	if workspace == nil {
		return false
	}

	member := workspace.GetMember(userID)
	if member == nil {
		return false
	}

	return member.Role == WorkspaceRoleOwner ||
		member.Role == WorkspaceRoleAdmin
}

// CanBeDeletedBy returns true if the user can delete this comment
func (ac *ArticleComment) CanBeDeletedBy(userID uuid.UUID, workspace *Workspace) bool {
	// Comment creator can delete
	if ac.UserID == userID {
		return true
	}

	// Check workspace permissions
	if workspace == nil {
		return false
	}

	member := workspace.GetMember(userID)
	if member == nil {
		return false
	}

	return member.Role == WorkspaceRoleOwner ||
		member.Role == WorkspaceRoleAdmin
}
