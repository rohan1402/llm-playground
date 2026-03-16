import { useState, useEffect, useRef } from "react";
import { fetchModels, fetchUpstreamStatus, sendChatStream, type ChatMessage, type ChatResponse, type UpstreamStatus } from "./api";
import "./App.css";

function App() {
  const [models, setModels] = useState<string[]>([]);
  const [model, setModel] = useState("llama3.1-8b-instruct");
  const [temperature, setTemperature] = useState(0.2);
  const [maxTokens, setMaxTokens] = useState(512);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [lastResponse, setLastResponse] = useState<ChatResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [upstream, setUpstream] = useState<UpstreamStatus | null>(null);
  const [upstreamError, setUpstreamError] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetchModels()
      .then((m) => {
        setModels(m);
        if (m.length > 0 && !m.includes(model)) setModel(m[0]);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load models"));
  }, []);

  useEffect(() => {
    const poll = () => {
      fetchUpstreamStatus()
        .then((s) => {
          setUpstream(s);
          setUpstreamError(null);
        })
        .catch((e) => {
          setUpstreamError(e instanceof Error ? e.message : "Upstream status unavailable");
          setUpstream(null);
        });
    };
    poll();
    const id = setInterval(poll, 10_000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleSend = async () => {
    const text = input.trim();
    if (!text || loading) return;

    const userMsg: ChatMessage = { role: "user", content: text };
    const nextMessages = [...messages, userMsg];
    setMessages(nextMessages);
    setInput("");
    setLoading(true);
    setError(null);
    setLastResponse(null);

    // Add an empty assistant message that we'll fill token-by-token
    setMessages((prev) => [...prev, { role: "assistant", content: "" }]);

    try {
      for await (const event of sendChatStream({ model, messages: nextMessages, temperature, max_tokens: maxTokens })) {
        if (event.error) {
          setError(event.error);
          // Remove the empty assistant message on error
          setMessages((prev) => prev.slice(0, -1));
          break;
        }
        if (event.token) {
          setMessages((prev) => {
            const last = prev[prev.length - 1];
            if (!last || last.role !== "assistant") return prev;
            return [...prev.slice(0, -1), { ...last, content: last.content + event.token }];
          });
        }
        if (event.done) {
          setLastResponse({
            request_id: "",
            model,
            reply: "",
            latency_ms: event.latency_ms ?? 0,
            usage: { prompt_tokens: null, completion_tokens: null, total_tokens: null },
            error: null,
          });
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Request failed");
      setMessages((prev) => prev.slice(0, -1));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="app">
      <header className="header">
        <h1>LLM Playground</h1>
        <div className="header-meta">
          <div className="upstream-badge">
            {upstream ? (
              <>
                <span
                  className={`upstream-dot ${upstream.reachable ? "upstream-dot--connected" : "upstream-dot--down"}`}
                  title={upstream.error?.message ?? undefined}
                />
                {upstream.reachable
                  ? "Upstream: Connected"
                  : upstream.error?.code === "UPSTREAM_TIMEOUT"
                    ? "Upstream: Busy (eval may be running)"
                    : "Upstream: Down"}
                {upstream.upstream.model_id && (
                  <span className="upstream-model" title="Model reported by upstream server">
                    {upstream.upstream.model_id.length > 40
                      ? `${upstream.upstream.model_id.slice(0, 37)}...`
                      : upstream.upstream.model_id}
                  </span>
                )}
                {upstream.baseUrl && (
                  <span className="upstream-baseurl" title={`Base URL: ${upstream.baseUrl}`}>
                    {upstream.baseUrl}
                  </span>
                )}
                {!upstream.reachable && (
                  <span className="upstream-warning">
                    {upstream.error?.code === "UPSTREAM_TIMEOUT"
                      ? "— If eval is running, this may be temporary"
                      : "— Model comparisons invalid until fixed"}
                  </span>
                )}
              </>
            ) : upstreamError ? (
              <span className="upstream-error" title={upstreamError}>
                Upstream: {upstreamError}
                <span className="upstream-warning"> — If eval is running, this may be temporary</span>
              </span>
            ) : (
              <span className="upstream-loading">Upstream: …</span>
            )}
          </div>
        </div>
        <div className="controls">
          <label title="Only one upstream model is loaded at a time; to switch models, restart upstream with a different GGUF.">
            Model
            <select value={model} onChange={(e) => setModel(e.target.value)}>
              {models.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </label>
          <label>
            Temperature
            <input
              type="number"
              min={0}
              max={2}
              step={0.1}
              value={temperature}
              onChange={(e) => setTemperature(Number(e.target.value))}
            />
          </label>
          <label>
            Max tokens
            <input
              type="number"
              min={1}
              max={4096}
              value={maxTokens}
              onChange={(e) => setMaxTokens(Number(e.target.value))}
            />
          </label>
        </div>
      </header>

      <main className="chat">
        <div className="messages">
          {messages.length === 0 && (
            <p className="empty">Send a message to start the conversation.</p>
          )}
          {messages.map((msg, i) => (
            <div key={i} className={`message message--${msg.role}`}>
              <span className="message-role">{msg.role}</span>
              <pre className="message-content">{msg.content}</pre>
            </div>
          ))}
          {loading && (
            <div className="message message--assistant">
              <span className="message-role">assistant</span>
              <span className="message-loading">Thinking...</span>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        {lastResponse && (
          <div className="metrics">
            <span>Latency: {lastResponse.latency_ms}ms</span>
            {lastResponse.usage.total_tokens != null && (
              <span>
                Tokens: {lastResponse.usage.prompt_tokens ?? "?"} prompt /{" "}
                {lastResponse.usage.completion_tokens ?? "?"} completion
              </span>
            )}
          </div>
        )}

        {error && <div className="error">{error}</div>}

        <form
          className="input-form"
          onSubmit={(e) => {
            e.preventDefault();
            handleSend();
          }}
        >
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleSend();
              }
            }}
            placeholder="Type a message..."
            rows={2}
            disabled={loading}
          />
          <button type="submit" disabled={loading}>
            Send
          </button>
        </form>
      </main>
    </div>
  );
}

export default App;
