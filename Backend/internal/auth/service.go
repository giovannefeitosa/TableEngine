package auth

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"golang.org/x/crypto/bcrypt"

	"tableengine/internal/config"
	"tableengine/internal/database"
)

type Service struct {
	db  *database.DB
	cfg *config.Config
}

func NewService(db *database.DB, cfg *config.Config) *Service {
	return &Service{db: db, cfg: cfg}
}

// Authenticate validates user credentials and issues a JWT token.
func (s *Service) Authenticate(ctx context.Context, userName, password string) (*LoginResponse, error) {
	var (
		userID         uuid.UUID
		firstName      string
		lastName       *string
		email          *string
		isActive       bool
		passwordHash   string
		failedAttempts int
		lockedUntil    *time.Time
	)

	// Fetch user and credential
	err := s.db.Pool.QueryRow(ctx, `
		SELECT u.sys_id, u.first_name, u.last_name, u.email, u.is_active,
		       c.password_hash, c.failed_attempts, c.locked_until
		FROM sys_user u
		JOIN sys_user_credential c ON c.user_id = u.sys_id
		WHERE u.user_name = $1
	`, userName).Scan(
		&userID, &firstName, &lastName, &email, &isActive,
		&passwordHash, &failedAttempts, &lockedUntil,
	)

	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, errors.New("credenciais inválidas")
		}
		return nil, fmt.Errorf("erro ao consultar usuário: %w", err)
	}

	if !isActive {
		return nil, errors.New("usuário inativo ou desabilitado")
	}

	// Check brute force lock
	if lockedUntil != nil && lockedUntil.After(time.Now()) {
		return nil, fmt.Errorf("conta bloqueada devido a excesso de tentativas. Tente novamente após %s", lockedUntil.Format(time.RFC3339))
	}

	// Compare password
	if err := bcrypt.CompareHashAndPassword([]byte(passwordHash), []byte(password)); err != nil {
		// Increment failed attempts
		newAttempts := failedAttempts + 1
		var newLockedUntil *time.Time
		if newAttempts >= 5 {
			t := time.Now().Add(15 * time.Minute)
			newLockedUntil = &t
		}
		_, _ = s.db.Pool.Exec(ctx, `
			UPDATE sys_user_credential
			SET failed_attempts = $1, locked_until = $2
			WHERE user_id = $3
		`, newAttempts, newLockedUntil, userID)

		return nil, errors.New("credenciais inválidas")
	}

	// Reset failed attempts on success
	_, _ = s.db.Pool.Exec(ctx, `
		UPDATE sys_user_credential
		SET failed_attempts = 0, locked_until = NULL
		WHERE user_id = $1
	`, userID)

	// Build user object with real-time groups and roles
	userObj, err := s.GetEffectiveUser(ctx, userID)
	if err != nil {
		return nil, err
	}

	// Generate JWT (HS256, 8 hours expiration)
	claims := Claims{
		UserName: userName,
		RegisteredClaims: jwt.RegisteredClaims{
			Subject:   userID.String(),
			Issuer:    "tableengine-api",
			IssuedAt:  jwt.NewNumericDate(time.Now()),
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(8 * time.Hour)),
		},
	}

	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	tokenStr, err := token.SignedString([]byte(s.cfg.JWTSecret))
	if err != nil {
		return nil, fmt.Errorf("falha ao assinar token: %w", err)
	}

	return &LoginResponse{
		Token: tokenStr,
		User:  *userObj,
	}, nil
}

// GetEffectiveUser retrieves user details, active groups and active roles directly from PostgreSQL (zero cache).
func (s *Service) GetEffectiveUser(ctx context.Context, userID uuid.UUID) (*User, error) {
	var (
		u        User
		lastName *string
		email    *string
	)

	err := s.db.Pool.QueryRow(ctx, `
		SELECT sys_id, user_name, first_name, last_name, email, is_active
		FROM sys_user
		WHERE sys_id = $1
	`, userID).Scan(&u.SysID, &u.UserName, &u.FirstName, &lastName, &email, &u.IsActive)
	if err != nil {
		return nil, fmt.Errorf("usuário não encontrado: %w", err)
	}
	if lastName != nil {
		u.LastName = *lastName
	}
	if email != nil {
		u.Email = *email
	}

	// Active Groups
	groupRows, err := s.db.Pool.Query(ctx, `
		SELECT g.sys_id, g.name
		FROM sys_user_group g
		JOIN sys_user_grmember gm ON gm.group_id = g.sys_id
		WHERE gm.user_id = $1 AND g.is_active = TRUE
		ORDER BY g.name ASC
	`, userID)
	if err != nil {
		return nil, err
	}
	defer groupRows.Close()

	u.Groups = make([]GroupSummary, 0)
	for groupRows.Next() {
		var g GroupSummary
		if err := groupRows.Scan(&g.SysID, &g.Name); err == nil {
			u.Groups = append(u.Groups, g)
		}
	}

	// Active Roles inherited from active groups
	roleRows, err := s.db.Pool.Query(ctx, `
		SELECT DISTINCT r.sys_id, r.name
		FROM sys_user_role r
		JOIN sys_group_has_role gr ON gr.role_id = r.sys_id
		JOIN sys_user_group g ON g.sys_id = gr.group_id
		JOIN sys_user_grmember gm ON gm.group_id = g.sys_id
		WHERE gm.user_id = $1 AND g.is_active = TRUE AND r.is_active = TRUE
		ORDER BY r.name ASC
	`, userID)
	if err != nil {
		return nil, err
	}
	defer roleRows.Close()

	u.Roles = make([]RoleSummary, 0)
	for roleRows.Next() {
		var r RoleSummary
		if err := roleRows.Scan(&r.SysID, &r.Name); err == nil {
			u.Roles = append(u.Roles, r)
		}
	}

	return &u, nil
}

// ResolveSecurityContext builds the SecurityContext in real-time from PostgreSQL.
func (s *Service) ResolveSecurityContext(ctx context.Context, userID uuid.UUID) (*SecurityContext, error) {
	u, err := s.GetEffectiveUser(ctx, userID)
	if err != nil {
		return nil, err
	}
	if !u.IsActive {
		return nil, errors.New("usuário inativo")
	}

	sec := &SecurityContext{
		UserID:    u.SysID,
		UserName:  u.UserName,
		Groups:    make([]uuid.UUID, len(u.Groups)),
		RoleIDs:   make([]uuid.UUID, len(u.Roles)),
		RoleNames: make([]string, len(u.Roles)),
	}

	for i, g := range u.Groups {
		sec.Groups[i] = g.SysID
	}
	for i, r := range u.Roles {
		sec.RoleIDs[i] = r.SysID
		sec.RoleNames[i] = r.Name
	}

	return sec, nil
}

// HasPermission checks authorization in real-time directly on PostgreSQL without cache.
func (s *Service) HasPermission(ctx context.Context, userCtx *SecurityContext, tableID uuid.UUID, operation string, fieldName, actionName *string) (bool, error) {
	if userCtx == nil {
		return false, errors.New("contexto de usuário ausente")
	}

	// Universal Admin bypass
	if userCtx.HasRole("admin") {
		return true, nil
	}

	if len(userCtx.RoleIDs) == 0 {
		return false, nil
	}

	var hasPerm bool
	err := s.db.Pool.QueryRow(ctx, `
		SELECT EXISTS (
			SELECT 1
			FROM sys_permission p
			JOIN sys_role_has_permission rp ON rp.permission_id = p.sys_id
			WHERE rp.role_id = ANY($1)
			  AND p.table_id = $2
			  AND p.operation = $3
			  AND p.is_active = TRUE
			  AND ($4::VARCHAR IS NULL OR p.field_name = $4 OR p.field_name IS NULL)
			  AND ($5::VARCHAR IS NULL OR p.action_name = $5)
		)
	`, userCtx.RoleIDs, tableID, operation, fieldName, actionName).Scan(&hasPerm)

	return hasPerm, err
}
