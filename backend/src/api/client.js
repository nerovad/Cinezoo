"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.api = void 0;
const BASE = "http://localhost:4000";
function authHeaders() {
    const token = localStorage.getItem("token");
    return token ? { Authorization: `Bearer ${token}` } : {};
}
function request(path_1) {
    return __awaiter(this, arguments, void 0, function* (path, init = {}) {
        // Build a Headers object so we don't fight union types (HeadersInit)
        const headers = new Headers(init.headers || {});
        // set JSON content-type unless caller already set it
        if (!headers.has("Content-Type"))
            headers.set("Content-Type", "application/json");
        // add auth header if present
        const auth = authHeaders();
        for (const [k, v] of Object.entries(auth))
            headers.set(k, v);
        const res = yield fetch(`${BASE}${path}`, Object.assign(Object.assign({}, init), { headers }));
        const text = yield res.text();
        let data = {};
        try {
            data = text ? JSON.parse(text) : {};
        }
        catch ( /* non-JSON, ignore */_a) { /* non-JSON, ignore */ }
        if (!res.ok) {
            throw new Error((data === null || data === void 0 ? void 0 : data.error) || (data === null || data === void 0 ? void 0 : data.message) || `HTTP ${res.status}`);
        }
        return data;
    });
}
exports.api = {
    // channels
    createChannel: (body) => request("/api/channels", { method: "POST", body: JSON.stringify(body) }),
    listChannels: () => request("/api/channels"),
    getChannel: (slug) => request(`/api/channels/${slug}`),
    // festivals/sessions
    createSession: (body) => request(`/api/festivals`, { method: "POST", body: JSON.stringify(body) }),
    startSession: (sessionId) => request(`/api/festivals/${sessionId}/start`, { method: "POST" }),
    closeSession: (sessionId) => request(`/api/festivals/${sessionId}/close`, { method: "POST" }),
    lineup: (sessionId) => request(`/api/festivals/${sessionId}/lineup`),
    addEntry: (sessionId, body) => request(`/api/festivals/${sessionId}/entries`, { method: "POST", body: JSON.stringify(body) }),
    // films
    createFilm: (title) => request(`/api/films`, { method: "POST", body: JSON.stringify({ title }) }),
    listFilms: () => request(`/api/films`),
    // voting
    leaderboard: (sessionId) => request(`/api/sessions/${sessionId}/leaderboard`),
};
