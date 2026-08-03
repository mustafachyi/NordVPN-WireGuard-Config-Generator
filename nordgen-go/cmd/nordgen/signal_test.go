package main

import (
	"bytes"
	"context"
	"errors"
	"os"
	"strings"
	"testing"
	"time"

	"nordgen/internal/models"
	"nordgen/internal/ui"
)

type signalTestAPI struct{}

func (signalTestAPI) GetKey(context.Context, string) (string, error) {
	return "", errors.New("unexpected key request")
}

func (signalTestAPI) GetGeo(context.Context) (models.Coordinates, error) {
	return models.Coordinates{}, errors.New("unexpected geolocation request")
}

func (signalTestAPI) GetServers(context.Context) ([]models.RawServer, error) {
	return nil, errors.New("unexpected server request")
}

func TestCloseInputOnCancellationUnblocksRead(t *testing.T) {
	reader, writer, err := os.Pipe()
	if err != nil {
		t.Fatalf("Pipe() error = %v", err)
	}
	defer writer.Close()

	ctx, cancel := context.WithCancel(context.Background())
	stop := closeInputOnCancellation(ctx, reader)
	defer stop()

	readResult := make(chan error, 1)
	go func() {
		var value [1]byte
		_, readErr := reader.Read(value[:])
		readResult <- readErr
	}()

	cancel()

	select {
	case readErr := <-readResult:
		if readErr == nil {
			t.Fatal("Read() succeeded after cancellation")
		}
	case <-time.After(time.Second):
		t.Fatal("cancellation did not unblock the input read")
	}
}

func TestCloseInputOnCancellationStopPreservesInput(t *testing.T) {
	reader, writer, err := os.Pipe()
	if err != nil {
		t.Fatalf("Pipe() error = %v", err)
	}
	defer reader.Close()
	defer writer.Close()

	ctx, cancel := context.WithCancel(context.Background())
	stop := closeInputOnCancellation(ctx, reader)
	stop()
	cancel()

	if _, err := writer.Write([]byte{'x'}); err != nil {
		t.Fatalf("Write() error = %v", err)
	}
	var value [1]byte
	if _, err := reader.Read(value[:]); err != nil {
		t.Fatalf("Read() error = %v", err)
	}
	if value[0] != 'x' {
		t.Fatalf("Read() value = %q", value[0])
	}
}

func TestResolvePrivateKeyMapsCancelledPromptRead(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()

	manager := ui.NewConsoleManager(strings.NewReader(""), &bytes.Buffer{})
	_, err := resolvePrivateKey(ctx, manager, signalTestAPI{}, "")
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("resolvePrivateKey() error = %v", err)
	}
}
