package api

import (
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/go-chi/cors"

	"tableengine/internal/auth"
	"tableengine/internal/config"
)

// SetupRouter initializes Chi router and maps all TableEngine endpoints.
func SetupRouter(h *Handlers, authService *auth.Service, cfg *config.Config) *chi.Mux {
	r := chi.NewRouter()

	// Base Middlewares
	r.Use(middleware.RequestID)
	r.Use(middleware.RealIP)
	r.Use(middleware.Logger)
	r.Use(middleware.Recoverer)

	// Permissive CORS for seamless local and dockerized access
	r.Use(cors.Handler(cors.Options{
		AllowedOrigins:   []string{"*"},
		AllowedMethods:   []string{"GET", "POST", "PUT", "DELETE", "OPTIONS"},
		AllowedHeaders:   []string{"Accept", "Authorization", "Content-Type", "X-CSRF-Token"},
		ExposedHeaders:   []string{"Link"},
		AllowCredentials: true,
		MaxAge:           300,
	}))

	// Health check
	r.Get("/health", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"status":"ok","engine":"TableEngine v2"}`))
	})

	// API v1
	r.Route("/api/v1", func(v1 chi.Router) {
		// Public Auth
		v1.Post("/auth/login", h.Login)

		// Protected Routes
		v1.Group(func(pr chi.Router) {
			pr.Use(auth.Middleware(authService, cfg))

			// Auth Context
			pr.Get("/auth/me", h.GetMe)

			// Schema & DDL
			pr.Get("/schema/tables", h.ListTables)
			pr.Post("/schema/tables", h.CreateTable)
			pr.Get("/schema/tables/{table_id}", h.GetTable)
			pr.Put("/schema/tables/{table_id}", h.UpdateTable)
			pr.Delete("/schema/tables/{table_id}", h.DeleteTable)

			pr.Post("/schema/tables/{table_id}/fields", h.AddField)
			pr.Get("/schema/tables/{table_name}/fields", h.GetTableFields)
			pr.Get("/schema/fields/{field_id}", h.GetField)
			pr.Put("/schema/fields/{field_id}", h.UpdateField)
			pr.Delete("/schema/fields/{field_id}", h.DeleteField)

			pr.Post("/schema/choices", h.AddChoice)
			pr.Get("/schema/tables/{table_name}/choices", h.GetTableChoices)
			pr.Get("/schema/choices/{table_name}/{element}", h.GetChoices)
			pr.Get("/schema/choices/{choice_id}", h.GetChoice)
			pr.Put("/schema/choices/{choice_id}", h.UpdateChoice)
			pr.Delete("/schema/choices/{choice_id}", h.DeleteChoice)

			pr.Post("/schema/numbers", h.ConfigureNumber)

			// FSM & Rules Management
			pr.Get("/fsm/transitions", h.ListTransitions)
			pr.Post("/fsm/transitions", h.CreateTransition)
			pr.Get("/fsm/transitions/{transition_id}", h.GetTransition)
			pr.Put("/fsm/transitions/{transition_id}", h.UpdateTransition)
			pr.Delete("/fsm/transitions/{transition_id}", h.DeleteTransition)

			pr.Get("/rules/scripts", h.ListBusinessRules)
			pr.Post("/rules/scripts", h.CreateBusinessRule)
			pr.Get("/rules/scripts/{rule_id}", h.GetBusinessRule)
			pr.Put("/rules/scripts/{rule_id}", h.UpdateBusinessRule)
			pr.Delete("/rules/scripts/{rule_id}", h.DeleteBusinessRule)

			// RBAC Management
			pr.Get("/rbac/users", h.ListUsers)
			pr.Post("/rbac/users", h.CreateUser)
			pr.Get("/rbac/users/{user_id}", h.GetUser)
			pr.Put("/rbac/users/{user_id}", h.UpdateUser)
			pr.Delete("/rbac/users/{user_id}", h.DeleteUser)

			pr.Get("/rbac/groups", h.ListGroups)
			pr.Post("/rbac/groups", h.CreateGroup)
			pr.Get("/rbac/groups/{group_id}", h.GetGroup)
			pr.Put("/rbac/groups/{group_id}", h.UpdateGroup)
			pr.Delete("/rbac/groups/{group_id}", h.DeleteGroup)

			pr.Get("/rbac/roles", h.ListRoles)
			pr.Post("/rbac/roles", h.CreateRole)
			pr.Get("/rbac/roles/{role_id}", h.GetRole)
			pr.Put("/rbac/roles/{role_id}", h.UpdateRole)
			pr.Delete("/rbac/roles/{role_id}", h.DeleteRole)

			pr.Get("/rbac/permissions", h.ListPermissions)
			pr.Post("/rbac/permissions", h.CreatePermission)
			pr.Get("/rbac/permissions/{permission_id}", h.GetPermission)
			pr.Put("/rbac/permissions/{permission_id}", h.UpdatePermission)
			pr.Delete("/rbac/permissions/{permission_id}", h.DeletePermission)


			// Polymorphic CRUD & FSM UI Actions
			pr.Post("/records/{table}", h.CreateRecord)
			pr.Get("/records/{table}", h.ReadRecords)
			pr.Get("/records/{table}/{sys_id}", h.ReadSingleRecord)
			pr.Put("/records/{table}/{sys_id}", h.UpdateRecord)
			pr.Delete("/records/{table}/{sys_id}", h.DeleteRecord)

			// FSM State Transitions
			pr.Get("/records/{table}/{sys_id}/available-transitions", h.GetAvailableTransitions)
			pr.Post("/records/{table}/{sys_id}/transitions/{transition_id}", h.ExecuteTransition)

			// Universal Audit Trail
			pr.Get("/records/{table}/{sys_id}/audit", h.GetAuditHistory)
		})
	})

	return r
}
