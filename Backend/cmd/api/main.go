package main

import (
	"context"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"tableengine/internal/api"
	"tableengine/internal/audit"
	"tableengine/internal/auth"
	"tableengine/internal/config"
	"tableengine/internal/crud"
	"tableengine/internal/database"
	"tableengine/internal/ddl"
	"tableengine/internal/fsm"
	"tableengine/internal/numbering"
	"tableengine/internal/rules"
)

func main() {
	log.Println("==================================================")
	log.Println("       TableEngine v2 - Dynamic Metadata aPaaS    ")
	log.Println("==================================================")

	cfg := config.LoadConfig()
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	// 1. Connect to PostgreSQL
	db, err := database.Connect(ctx, cfg)
	if err != nil {
		log.Fatalf("Fatal: Database connection failed: %v", err)
	}
	defer db.Pool.Close()

	// 2. Run initial Kernel schema migration and bootstrap
	if err := db.MigrateAndBootstrap(ctx); err != nil {
		log.Fatalf("Fatal: Kernel migration & bootstrap failed: %v", err)
	}

	// 3. Initialize Domain Engines
	authService := auth.NewService(db, cfg)
	ddlEngine := ddl.NewEngine(db)
	numEngine := numbering.NewEngine(db)
	fsmEngine := fsm.NewEngine(db, authService)
	rulesEngine := rules.NewEngine(db)
	crudEngine := crud.NewEngine(db, ddlEngine, numEngine, fsmEngine, rulesEngine, authService)
	auditEngine := audit.NewEngine(db)

	handlers := api.NewHandlers(
		db,
		authService,
		ddlEngine,
		numEngine,
		fsmEngine,
		rulesEngine,
		crudEngine,
		auditEngine,
	)

	// 4. Setup Router
	router := api.SetupRouter(handlers, authService, cfg)

	server := &http.Server{
		Addr:         ":" + cfg.Port,
		Handler:      router,
		ReadTimeout:  30 * time.Second,
		WriteTimeout: 30 * time.Second,
		IdleTimeout:  120 * time.Second,
	}

	// Graceful shutdown handling
	stopChan := make(chan os.Signal, 1)
	signal.Notify(stopChan, os.Interrupt, syscall.SIGTERM)

	go func() {
		log.Printf("TableEngine REST API running on port %s (http://localhost:%s/api/v1)", cfg.Port, cfg.Port)
		if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("HTTP server listen error: %v", err)
		}
	}()

	<-stopChan
	log.Println("Shutting down TableEngine server gracefully...")

	shutdownCtx, shutdownCancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer shutdownCancel()

	if err := server.Shutdown(shutdownCtx); err != nil {
		log.Printf("Server forced to shutdown: %v", err)
	}

	log.Println("TableEngine server exited cleanly.")
	fmt.Println("Goodbye!")
}
