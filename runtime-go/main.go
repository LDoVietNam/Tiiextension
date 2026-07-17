package main

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"flag"
	"fmt"
	"log"
	"net/http"
	"sync"

	"github.com/gorilla/websocket"
)

// JSONRPCMessage represents a standard JSON-RPC 2.0 message
type JSONRPCMessage struct {
	JSONRPC string          `json:"jsonrpc"`
	Method  string          `json:"method,omitempty"`
	Params  json.RawMessage `json:"params,omitempty"`
	Result  json.RawMessage `json:"result,omitempty"`
	Error   *JSONRPCError   `json:"error,omitempty"`
	ID      any             `json:"id,omitempty"`
}

type JSONRPCError struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
	Data    any    `json:"data,omitempty"`
}

type ClientSession struct {
	conn       *websocket.Conn
	mu         sync.Mutex
	sessionID  string
	authorized bool
}

var (
	upgrader = websocket.Upgrader{
		ReadBufferSize:  1024,
		WriteBufferSize: 1024,
		CheckOrigin: func(r *http.Request) bool {
			return true // Allow connection from extension pages
		},
	}

	// In-memory store for generated pairing codes and active sessions
	pairingCode   string
	activeSession string
	sessionMutex  sync.RWMutex

	clients = make(map[*ClientSession]bool)
	clientMu sync.Mutex
)

func generateRandomString(length int) string {
	bytes := make([]byte, length/2)
	if _, err := rand.Read(bytes); err != nil {
		return "123456" // fallback
	}
	return hex.EncodeToString(bytes)
}

func main() {
	port := flag.Int("port", 9000, "Port to run the bridge server")
	flag.Parse()

	// Generate a unique 6-character pairing code for the first-time session setup
	sessionMutex.Lock()
	pairingCode = generateRandomString(6)
	log.Printf("====================================================")
	log.Printf("👉 Tiiextension Bridge Pairing Code: %s", pairingCode)
	log.Printf("====================================================")
	sessionMutex.Unlock()

	http.HandleFunc("/v1/extension", handleWebsocket)

	addr := fmt.Sprintf("127.0.0.1:%d", *port)
	log.Printf("Ti Agent Runtime Bridge server starting on ws://%s/v1/extension", addr)
	if err := http.ListenAndServe(addr, nil); err != nil {
		log.Fatalf("ListenAndServe error: %v", err)
	}
}

func handleWebsocket(w http.ResponseWriter, r *http.Request) {
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Printf("Upgrade error: %v", err)
		return
	}
	defer conn.Close()

	client := &ClientSession{
		conn: conn,
	}

	clientMu.Lock()
	clients[client] = true
	clientMu.Unlock()

	defer func() {
		clientMu.Lock()
		delete(clients, client)
		clientMu.Unlock()
		log.Printf("Client disconnected")
	}()

	log.Printf("New WebSocket client connected")

	for {
		_, message, err := conn.ReadMessage()
		if err != nil {
			if websocket.IsUnexpectedCloseError(err, websocket.CloseGoingAway, websocket.CloseAbnormalClosure) {
				log.Printf("ReadMessage error: %v", err)
			}
			break
		}

		var req JSONRPCMessage
		if err := json.Unmarshal(message, &req); err != nil {
			sendError(conn, nil, -32700, "Parse error")
			continue
		}

		if req.Method != "" {
			handleRequest(client, &req)
		}
	}
}

func handleRequest(client *ClientSession, req *JSONRPCMessage) {
	switch req.Method {
	case "runtime.pair":
		var params struct {
			Code string `json:"code"`
		}
		if err := json.Unmarshal(req.Params, &params); err != nil {
			sendError(client.conn, req.ID, -32602, "Invalid params")
			return
		}

		sessionMutex.RLock()
		correct := params.Code == pairingCode
		sessionMutex.RUnlock()

		if !correct {
			sendError(client.conn, req.ID, -32001, "Invalid pairing code")
			return
		}

		// Success: generate session ID
		sessionMutex.Lock()
		activeSession = "sess_" + generateRandomString(16)
		sessID := activeSession
		sessionMutex.Unlock()

		client.sessionID = sessID
		client.authorized = true

		result := map[string]string{
			"sessionId": sessID,
			"status":    "paired",
		}
		sendResult(client.conn, req.ID, result)
		log.Printf("Client successfully paired. Session ID: %s", sessID)

	case "runtime.hello":
		var params struct {
			SessionID string `json:"sessionId"`
		}
		if err := json.Unmarshal(req.Params, &params); err != nil {
			sendError(client.conn, req.ID, -32602, "Invalid params")
			return
		}

		sessionMutex.RLock()
		valid := activeSession != "" && params.SessionID == activeSession
		sessionMutex.RUnlock()

		if !valid {
			sendError(client.conn, req.ID, -32002, "Unauthorized session")
			return
		}

		client.sessionID = params.SessionID
		client.authorized = true

		result := map[string]any{
			"sessionId":      params.SessionID,
			"runtimeVersion": "1.0.0",
			"heartbeatMs":    20000,
			"capabilities": []string{
				"workspace.files",
				"workspace.patch",
				"terminal.process",
				"git",
				"artifacts",
				"agent.tasks",
			},
		}
		sendResult(client.conn, req.ID, result)
		log.Printf("Session hello handshake success: %s", params.SessionID)

	default:
		if !client.authorized {
			sendError(client.conn, req.ID, -32002, "Unauthorized")
			return
		}
		// Proxy or generic echo handler for other requests
		sendError(client.conn, req.ID, -32601, fmt.Sprintf("Method %s not implemented yet", req.Method))
	}
}

func sendResult(conn *websocket.Conn, id any, result any) {
	resultBytes, _ := json.Marshal(result)
	msg := JSONRPCMessage{
		JSONRPC: "2.0",
		Result:  resultBytes,
		ID:      id,
	}
	_ = conn.WriteJSON(msg)
}

func sendError(conn *websocket.Conn, id any, code int, message string) {
	msg := JSONRPCMessage{
		JSONRPC: "2.0",
		Error: &JSONRPCError{
			Code:    code,
			Message: message,
		},
		ID: id,
	}
	_ = conn.WriteJSON(msg)
}
