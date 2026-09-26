package auth

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"

	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"tableengine/internal/config"
	"tableengine/internal/database"
)

type contextKey string

const SecurityContextKey contextKey = "security_context"

func GetSecurityContext(ctx context.Context) *SecurityContext {
	if val := ctx.Value(SecurityContextKey); val != nil {
		if sec, ok := val.(*SecurityContext); ok {
			return sec
		}
	}
	return nil
}

// Middleware verifies JWT and extracts real-time user identity.
func Middleware(authService *Service, cfg *config.Config) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			authHeader := r.Header.Get("Authorization")
			if authHeader == "" || !strings.HasPrefix(authHeader, "Bearer ") {
				respondJSONError(w, http.StatusUnauthorized, "UNAUTHORIZED", "Token de autenticação ausente ou inválido.")
				return
			}

			tokenStr := strings.TrimPrefix(authHeader, "Bearer ")
			claims := &Claims{}

			token, err := jwt.ParseWithClaims(tokenStr, claims, func(token *jwt.Token) (interface{}, error) {
				if _, ok := token.Method.(*jwt.SigningMethodHMAC); !ok {
					return nil, jwt.ErrSignatureInvalid
				}
				return []byte(cfg.JWTSecret), nil
			})

			if err != nil || !token.Valid {
				respondJSONError(w, http.StatusUnauthorized, "UNAUTHORIZED", "Token de autenticação expirado ou inválido.")
				return
			}

			userID, err := uuid.Parse(claims.Subject)
			if err != nil {
				respondJSONError(w, http.StatusUnauthorized, "UNAUTHORIZED", "Identificador de usuário inválido no token.")
				return
			}

			// Resolve active security context in real-time
			secCtx, err := authService.ResolveSecurityContext(r.Context(), userID)
			if err != nil {
				respondJSONError(w, http.StatusUnauthorized, "UNAUTHORIZED", "Usuário desativado ou sem permissão de acesso.")
				return
			}

			ctx := context.WithValue(r.Context(), SecurityContextKey, secCtx)
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}

// ExecuteInTx wraps DB operations in an atomic transaction with app.user_id set locally.
func ExecuteInTx(ctx context.Context, db *database.DB, userCtx *SecurityContext, fn func(tx pgx.Tx) error) error {
	tx, err := db.Pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	// Set app.user_id local to this transaction
	var actorID string
	if userCtx != nil {
		actorID = userCtx.UserID.String()
	} else {
		actorID = database.SystemServiceUserID.String()
	}

	if _, err := tx.Exec(ctx, "SELECT set_config('app.user_id', $1, true)", actorID); err != nil {
		return err
	}

	if err := fn(tx); err != nil {
		return err
	}

	return tx.Commit(ctx)
}

func respondJSONError(w http.ResponseWriter, status int, code, message string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(ErrorResponse{
		Error: APIError{
			Code:    code,
			Message: message,
		},
	})
}
