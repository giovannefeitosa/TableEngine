package auth

import (
	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
)

type User struct {
	SysID     uuid.UUID      `json:"sys_id"`
	UserName  string         `json:"user_name"`
	FirstName string         `json:"first_name"`
	LastName  string         `json:"last_name,omitempty"`
	Email     string         `json:"email,omitempty"`
	IsActive  bool           `json:"is_active"`
	Groups    []GroupSummary `json:"groups"`
	Roles     []RoleSummary  `json:"roles"`
}

type GroupSummary struct {
	SysID uuid.UUID `json:"sys_id"`
	Name  string    `json:"name"`
}

type RoleSummary struct {
	SysID uuid.UUID `json:"sys_id"`
	Name  string    `json:"name"`
}

type LoginRequest struct {
	UserName string `json:"user_name"`
	Password string `json:"password"`
}

type LoginResponse struct {
	Token string `json:"token"`
	User  User   `json:"user"`
}

type SecurityContext struct {
	UserID   uuid.UUID
	UserName string
	Groups   []uuid.UUID
	RoleIDs  []uuid.UUID
	RoleNames []string
}

func (s *SecurityContext) HasRole(name string) bool {
	for _, r := range s.RoleNames {
		if r == name {
			return true
		}
	}
	return false
}

type Claims struct {
	UserName string `json:"user_name"`
	jwt.RegisteredClaims
}

type APIError struct {
	Code    string      `json:"code"`
	Message string      `json:"message"`
	Details interface{} `json:"details"`
}

type ErrorResponse struct {
	Error APIError `json:"error"`
}
