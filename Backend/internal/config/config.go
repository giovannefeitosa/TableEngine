package config

import (
	"os"
)

type Config struct {
	Port                 string
	DatabaseURL          string
	JWTSecret            string
	InitialAdminUser     string
	InitialAdminPassword string
}

func LoadConfig() *Config {
	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	dbURL := os.Getenv("DATABASE_URL")
	if dbURL == "" {
		dbURL = "postgres://postgres:postgres@localhost:5432/table_engine?sslmode=disable"
	}

	jwtSecret := os.Getenv("JWT_SECRET")
	if jwtSecret == "" {
		jwtSecret = "table_engine_ultra_secure_default_secret_key_32_bytes"
	}

	adminUser := os.Getenv("INITIAL_ADMIN_USER")
	if adminUser == "" {
		adminUser = "admin"
	}

	adminPass := os.Getenv("INITIAL_ADMIN_PASSWORD")
	if adminPass == "" {
		adminPass = "Admin123!Safe"
	}

	return &Config{
		Port:                 port,
		DatabaseURL:          dbURL,
		JWTSecret:            jwtSecret,
		InitialAdminUser:     adminUser,
		InitialAdminPassword: adminPass,
	}
}
