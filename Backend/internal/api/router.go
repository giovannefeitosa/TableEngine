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
			pr.Post("/schema/tables/{table_id}/fields", h.AddField)
			pr.Get("/schema/tables/{table_name}/fields", h.GetTableFields)
			pr.Post("/schema/choices", h.AddChoice)
			pr.Get("/schema/choices/{table_name}/{element}", h.GetChoices)
			pr.Post("/schema/numbers", h.ConfigureNumber)

			// FSM & Rules Management
			pr.Get("/fsm/transitions", h.ListTransitions)
			pr.Post("/fsm/transitions", h.CreateTransition)
			pr.Get("/rules/scripts", h.ListBusinessRules)
			pr.Post("/rules/scripts", h.CreateBusinessRule)

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
