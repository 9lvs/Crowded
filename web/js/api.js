/* API layer. Talks to the real backend (same origin) or to the in-memory mock.
   Tokens: access token in memory only. Refresh token in localStorage "crowded.rt".
   Mock mode is only allowed when a bundle sets window.CROWDED_MOCK = true, or when ?mock=1 is
   used on localhost or a file: page. It never touches the real refresh token. */
(function () {
  "use strict";
  var C = (window.Crowded = window.Crowded || {});
  var ui = C.ui;

  function mockAllowed() {
    if (window.CROWDED_MOCK === true) return true;
    if (!/[?&]mock=1\b/.test(window.location.search)) return false;
    var host = window.location.hostname;
    return window.location.protocol === "file:" || host === "localhost" || host === "127.0.0.1";
  }
  var isMock = mockAllowed();
  var RT_KEY = isMock ? "crowded.mock.rt" : "crowded.rt";

  var access = null;
  var refreshing = null;

  function ApiError(status, detail) {
    this.status = status;
    this.detail = detail || "Something went wrong";
    this.message = this.detail;
  }
  ApiError.prototype = Object.create(Error.prototype);

  function getRefresh() {
    return ui.storage(RT_KEY);
  }

  function setTokens(pair) {
    access = pair ? pair.access_token : null;
    ui.storage(RT_KEY, pair ? pair.refresh_token : null);
  }

  function transport(method, path, body) {
    if (isMock) return C.mock.handle(method, path, body);
    var headers = { Accept: "application/json" };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    if (access) headers.Authorization = "Bearer " + access;
    return fetch(path, {
      method: method,
      headers: headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: "same-origin",
      cache: "no-store"
    }).then(
      function (r) {
        if (r.status === 204) return { status: 204, body: null };
        return r
          .json()
          .catch(function () {
            return null;
          })
          .then(function (j) {
            return { status: r.status, body: j };
          });
      },
      function () {
        return { status: 0, body: { detail: "You're offline. Check your connection." } };
      }
    );
  }

  function detailText(body) {
    if (!body) return null;
    var d = body.detail;
    if (typeof d === "string") return d;
    // FastAPI validation errors are a list of {msg}
    if (Array.isArray(d) && d.length && d[0].msg) return String(d[0].msg).replace(/^Value error, /, "");
    return null;
  }

  function refresh() {
    if (refreshing) return refreshing;
    var rt = getRefresh();
    if (!rt) return Promise.resolve(false);
    refreshing = transport("POST", "/v1/auth/refresh", { refresh_token: rt })
      .then(function (r) {
        if (r.status === 200 && r.body) {
          setTokens(r.body);
          C.api.me = r.body.user;
          return true;
        }
        if (r.status === 401 || r.status === 400) setTokens(null);
        return false;
      })
      .finally(function () {
        refreshing = null;
      });
    return refreshing;
  }

  function request(method, path, body, opts) {
    opts = opts || {};
    return transport(method, path, body).then(function (r) {
      if (r.status === 401 && !opts.noRetry && path.indexOf("/v1/auth/") !== 0) {
        return refresh().then(function (ok) {
          if (ok) return request(method, path, body, { noRetry: true });
          if (C.onAuthLost) C.onAuthLost();
          throw new ApiError(401, "Please sign in again");
        });
      }
      if (r.status === 429) {
        ui.toast("Slow down a sec");
        throw new ApiError(429, "Slow down a sec");
      }
      if (r.status >= 200 && r.status < 300) return r.body;
      throw new ApiError(r.status, detailText(r.body));
    });
  }

  C.api = {
    isMock: isMock,
    ApiError: ApiError,
    me: null,
    hasSession: function () {
      return !!getRefresh();
    },
    setTokens: setTokens,
    refresh: refresh,
    signOut: function () {
      var rt = getRefresh();
      setTokens(null);
      C.api.me = null;
      if (rt) return transport("POST", "/v1/auth/logout", { refresh_token: rt }).catch(function () {});
      return Promise.resolve();
    },

    // auth
    requestCode: function (phone) {
      return request("POST", "/v1/auth/request-code", { phone: phone });
    },
    verifyCode: function (phone, code, ageAttested) {
      return request("POST", "/v1/auth/verify-code", {
        phone: phone,
        code: code,
        age_attested: !!ageAttested,
        platform: "web"
      }).then(function (pair) {
        setTokens(pair);
        C.api.me = pair.user;
        return pair.user;
      });
    },

    // me
    getMe: function () {
      return request("GET", "/v1/me").then(function (me) {
        C.api.me = me;
        return me;
      });
    },
    updateThreshold: function (min) {
      return request("PATCH", "/v1/me", { wait_threshold_min: min }).then(function (me) {
        C.api.me = me;
        return me;
      });
    },
    deleteAccount: function () {
      return request("DELETE", "/v1/me").then(function () {
        setTokens(null);
        C.api.me = null;
      });
    },

    // bars
    bars: function () {
      return request("GET", "/v1/bars");
    },
    bar: function (id) {
      return request("GET", "/v1/bars/" + encodeURIComponent(id));
    },
    snapshots: function (id, hours) {
      return request("GET", "/v1/bars/" + encodeURIComponent(id) + "/snapshots?hours=" + (hours || 6));
    },

    // line sessions and reports
    activeSession: function () {
      return request("GET", "/v1/line-sessions/active");
    },
    startSession: function (barId, location) {
      var body = { bar_id: barId };
      if (location) body.location = location;
      return request("POST", "/v1/line-sessions", body);
    },
    endSession: function (id, outcome) {
      return request("POST", "/v1/line-sessions/" + encodeURIComponent(id) + "/end", { outcome: outcome });
    },
    report: function (barId, crowdLevel, lineSize, location) {
      var body = { bar_id: barId };
      if (crowdLevel) body.crowd_level = crowdLevel;
      if (lineSize) body.line_size = lineSize;
      if (location) body.location = location;
      return request("POST", "/v1/reports", body);
    },

    // staff
    redeemInvite: function (code) {
      return request("POST", "/v1/staff/invites/redeem", { code: code }).then(function (me) {
        C.api.me = me;
        return me;
      });
    },
    staffState: function (barId) {
      return request("GET", "/v1/staff/bars/" + encodeURIComponent(barId));
    },
    door: function (barId, direction, count) {
      return request("POST", "/v1/staff/bars/" + encodeURIComponent(barId) + "/door", {
        direction: direction,
        count: count || 1
      });
    },
    lineSize: function (barId, size) {
      return request("POST", "/v1/staff/bars/" + encodeURIComponent(barId) + "/line", { line_size: size });
    }
  };
})();
