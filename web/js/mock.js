/* In-memory mock of the Crowded API. ALL DATA HERE IS FAKE.
   Enabled with ?mock=1 or window.CROWDED_MOCK = true. Same request and response shapes as
   backend/app/schemas.py so the UI cannot tell the difference. */
(function () {
  "use strict";
  var C = (window.Crowded = window.Crowded || {});

  var BARS = [
    {
      id: "00000000-0000-4000-8000-000000000001",
      slug: "fake-tipsy-owl",
      name: "FAKE The Tipsy Owl",
      address: "101 Fake College Ave",
      latitude: 0,
      longitude: 0,
      capacity: 220,
      pass_price_cents: 1500,
      baseWait: 28,
      swing: 7,
      baseFill: 0.93,
      reports: 7,
      timers: 3,
      hasData: true,
      typical: [2, 5, 12, 22, 30, 34, 31, 24, 14, 6]
    },
    {
      id: "00000000-0000-4000-8000-000000000002",
      slug: "fake-copper-lantern",
      name: "FAKE Copper Lantern",
      address: "22 Pretend St",
      latitude: 0,
      longitude: 0,
      capacity: 150,
      pass_price_cents: 1000,
      baseWait: 11,
      swing: 4,
      baseFill: 0.71,
      reports: 4,
      timers: 1,
      hasData: true,
      typical: [0, 2, 5, 9, 13, 15, 14, 10, 6, 2]
    },
    {
      id: "00000000-0000-4000-8000-000000000003",
      slug: "fake-night-heron",
      name: "FAKE Night Heron",
      address: "9 Sample Row",
      latitude: 0,
      longitude: 0,
      capacity: 300,
      pass_price_cents: null,
      baseWait: 0,
      swing: 0,
      baseFill: 0,
      reports: 0,
      timers: 0,
      hasData: false,
      typical: [0, 0, 3, 8, 14, 19, 18, 12, 6, 1]
    }
  ];
  var HOURS = [18, 19, 20, 21, 22, 23, 0, 1, 2, 3];

  // ---------- persisted mock state (per tab) ----------
  var state = load() || { me: null, session: null, staff: {}, points: 0 };
  function load() {
    try {
      var raw = window.sessionStorage.getItem("crowded.mock");
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  }
  function save() {
    try {
      window.sessionStorage.setItem("crowded.mock", JSON.stringify(state));
    } catch (e) {
      /* ignore */
    }
  }

  function uuid() {
    var s = "";
    for (var i = 0; i < 32; i++) s += Math.floor(Math.random() * 16).toString(16);
    return s.slice(0, 8) + "-" + s.slice(8, 12) + "-4" + s.slice(13, 16) + "-8" + s.slice(17, 20) + "-" + s.slice(20, 32);
  }

  function nowIso() {
    return new Date().toISOString();
  }

  function priceText(cents) {
    var d = cents / 100;
    return "$" + (cents % 100 === 0 ? String(d) : d.toFixed(2));
  }

  function staffFor(bar) {
    if (!state.staff[bar.id]) {
      var hc = Math.round(bar.capacity * (bar.baseFill || 0.4));
      state.staff[bar.id] = {
        headcount: hc,
        entries: hc + 40,
        exits: 40,
        line_size: bar.hasData ? (bar.baseWait > 20 ? "long" : "short") : null,
        line_updated_at: bar.hasData ? new Date(Date.now() - 6 * 60000).toISOString() : null
      };
    }
    return state.staff[bar.id];
  }

  function crowdFrom(ratio) {
    if (ratio < 0.6) return "easy";
    if (ratio < 0.9) return "busy";
    return "packed";
  }

  function live(bar) {
    var st = staffFor(bar);
    if (!bar.hasData && !st.touched) {
      return {
        has_recent_data: false,
        wait_min: null,
        wait_low_min: null,
        wait_high_min: null,
        crowd_level: null,
        headcount: null,
        capacity_ratio: null,
        confidence: "none",
        basis: { text: "No recent data", window_min: 30, reports: 0, timers: 0, door_events: 0, staff_line_updates: 0 },
        flags: [],
        updated_at: nowIso()
      };
    }
    var t = Date.now() / 60000;
    var wobble = Math.sin(t / 4 + bar.baseWait) * bar.swing;
    var wait = Math.max(0, Math.round(bar.baseWait + wobble));
    var ratio = st.headcount / bar.capacity;
    var parts = [];
    if (bar.reports) parts.push(bar.reports + " report" + (bar.reports === 1 ? "" : "s"));
    if (bar.timers) parts.push(bar.timers + " timer" + (bar.timers === 1 ? "" : "s"));
    parts.push("staff counts");
    var joined = parts.length > 1 ? parts.slice(0, -1).join(", ") + " and " + parts[parts.length - 1] : parts[0];
    return {
      has_recent_data: true,
      wait_min: wait,
      wait_low_min: Math.round(wait * 0.75),
      wait_high_min: Math.round(wait * 1.3),
      crowd_level: crowdFrom(ratio),
      headcount: st.headcount,
      capacity_ratio: Math.round(ratio * 100) / 100,
      confidence: bar.timers >= 2 ? "high" : "medium",
      basis: {
        text: "Based on " + joined + " in the last 30 min",
        window_min: 30,
        reports: bar.reports,
        timers: bar.timers,
        door_events: 24,
        staff_line_updates: 1
      },
      flags: [],
      updated_at: nowIso()
    };
  }

  function verdict(bar, lv) {
    var T = state.me ? state.me.wait_threshold_min : 20;
    var P = bar.pass_price_cents;
    if (!lv.has_recent_data || lv.wait_min === null) {
      return { recommendation: "no_data", text: "No recent data. No call yet.", threshold_min: T, pass_price_cents: P, minutes_saved: null };
    }
    var W = lv.wait_min;
    if (W > T && P !== null) {
      return {
        recommendation: "buy_pass",
        text: "Get the pass. Line is about " + W + " min, over your " + T + " min limit. Pass is " + priceText(P) + ".",
        threshold_min: T,
        pass_price_cents: P,
        minutes_saved: W
      };
    }
    if (W > T) {
      return {
        recommendation: "no_pass_available",
        text: "Long line. About " + W + " min, over your " + T + " min limit. No pass sold here.",
        threshold_min: T,
        pass_price_cents: P,
        minutes_saved: null
      };
    }
    return {
      recommendation: "wait_it_out",
      text: "Wait it out. About " + W + " min, under your " + T + " min limit.",
      threshold_min: T,
      pass_price_cents: P,
      minutes_saved: null
    };
  }

  function summary(bar) {
    var lv = live(bar);
    return {
      id: bar.id,
      slug: bar.slug,
      name: bar.name,
      address: bar.address,
      capacity: bar.capacity,
      pass_price_cents: bar.pass_price_cents,
      live: lv,
      verdict: verdict(bar, lv)
    };
  }

  function currentHourIndex() {
    var hr = new Date().getHours();
    var idx = HOURS.indexOf(hr);
    // Outside 6 pm to 3 am, pretend it is 11 pm so the demo chart looks alive.
    return idx === -1 ? 5 : idx;
  }

  function detail(bar) {
    var s = summary(bar);
    var cur = currentHourIndex();
    s.latitude = bar.latitude;
    s.longitude = bar.longitude;
    s.normal_wait_min = bar.typical[cur];
    s.wait_by_hour = HOURS.map(function (hr, i) {
      var tonight = null;
      if (bar.hasData && i <= cur) {
        tonight = i === cur && s.live.wait_min !== null ? s.live.wait_min : Math.max(0, bar.typical[i] + ((i * 7) % 5) - 2);
      }
      return { hour: hr, typical_wait_min: bar.typical[i], tonight_wait_min: tonight };
    });
    return s;
  }

  function findBar(id) {
    for (var i = 0; i < BARS.length; i++) if (BARS[i].id === id) return BARS[i];
    return null;
  }

  function newMe() {
    return {
      id: uuid(),
      role: "user",
      wait_threshold_min: 20,
      staff_bar_id: null,
      phone_hint: "•• 00",
      created_at: nowIso()
    };
  }

  function tokens() {
    return {
      access_token: "mock-access-" + uuid(),
      refresh_token: "mock-refresh-" + uuid(),
      token_type: "bearer",
      expires_in: 900,
      user: state.me
    };
  }

  function staffState(bar) {
    var st = staffFor(bar);
    return {
      bar_id: bar.id,
      bar_name: bar.name,
      capacity: bar.capacity,
      headcount: st.headcount,
      entries_tonight: st.entries,
      exits_tonight: st.exits,
      line_size: st.line_size,
      line_updated_at: st.line_updated_at,
      live: live(bar)
    };
  }

  function res(status, body) {
    return { status: status, body: body === undefined ? null : body };
  }

  function err(status, detail) {
    return res(status, { detail: detail });
  }

  // ---------- router ----------
  function route(method, path, body) {
    var p = path.split("?")[0];
    var m;
    body = body || {};

    if (method === "POST" && p === "/v1/auth/request-code") {
      if (!body.phone) return err(422, "phone must be E.164, for example +15551234567");
      return res(200, { sent: true, expires_in: 300, dev_code: "123456" });
    }
    if (method === "POST" && p === "/v1/auth/verify-code") {
      if (!/^\d{6}$/.test(body.code || "")) return err(400, "Invalid or expired code");
      if (!body.age_attested && !state.me) return err(403, "age_gate");
      if (!state.me) state.me = newMe();
      var digits = String(body.phone || "").replace(/\D/g, "");
      state.me.phone_hint = "•• " + (digits.slice(-2) || "00");
      save();
      return res(200, tokens());
    }
    if (method === "POST" && p === "/v1/auth/refresh") {
      if (!/^mock-refresh-/.test(body.refresh_token || "") || !state.me) return err(401, "Invalid refresh token");
      return res(200, tokens());
    }
    if (method === "POST" && p === "/v1/auth/logout") {
      return res(204);
    }

    if (!state.me) return err(401, "Not authenticated");

    if (p === "/v1/me") {
      if (method === "GET") return res(200, state.me);
      if (method === "PATCH") {
        var t = body.wait_threshold_min;
        if (typeof t !== "number" || t < 5 || t > 120) return err(422, "wait_threshold_min must be 5 to 120");
        state.me.wait_threshold_min = t;
        save();
        return res(200, state.me);
      }
      if (method === "DELETE") {
        state = { me: null, session: null, staff: {}, points: 0 };
        save();
        return res(204);
      }
    }

    if (method === "GET" && p === "/v1/bars") return res(200, BARS.map(summary));
    if (method === "GET" && (m = p.match(/^\/v1\/bars\/([^/]+)$/))) {
      var b = findBar(m[1]);
      return b ? res(200, detail(b)) : err(404, "Bar not found");
    }
    if (method === "GET" && (m = p.match(/^\/v1\/bars\/([^/]+)\/snapshots$/))) {
      var b2 = findBar(m[1]);
      if (!b2) return err(404, "Bar not found");
      var lv = live(b2);
      return res(200, [
        { bar_id: b2.id, ts: lv.updated_at, has_recent_data: lv.has_recent_data, wait_min: lv.wait_min, crowd_level: lv.crowd_level, headcount: lv.headcount, confidence: lv.confidence }
      ]);
    }

    if (method === "GET" && p === "/v1/line-sessions/active") {
      return res(200, state.session && state.session.status === "active" ? state.session : null);
    }
    if (method === "POST" && p === "/v1/line-sessions") {
      var bar = findBar(body.bar_id);
      if (!bar) return err(404, "Bar not found");
      if (state.session && state.session.status === "active") return err(409, "You already have an active line session");
      var lvs = live(bar);
      state.session = {
        id: uuid(),
        bar_id: bar.id,
        status: "active",
        started_at: nowIso(),
        ended_at: null,
        predicted_wait_min: lvs.wait_min,
        actual_wait_min: null,
        near_bar: !!body.location,
        points_awarded: 0
      };
      save();
      return res(201, state.session);
    }
    if (method === "POST" && (m = p.match(/^\/v1\/line-sessions\/([^/]+)\/end$/))) {
      if (!state.session || state.session.id !== m[1]) return err(404, "Line session not found");
      if (state.session.status !== "active") return err(409, "Line session already ended");
      var ended = new Date();
      var mins = (ended.getTime() - new Date(state.session.started_at).getTime()) / 60000;
      state.session.status = body.outcome === "gave_up" ? "abandoned" : "completed";
      state.session.ended_at = ended.toISOString();
      state.session.actual_wait_min = Math.round(mins * 10) / 10;
      state.session.points_awarded = state.session.status === "completed" ? 10 : 0;
      state.points += state.session.points_awarded;
      var out = state.session;
      save();
      return res(200, out);
    }

    if (method === "POST" && p === "/v1/reports") {
      if (!findBar(body.bar_id)) return err(404, "Bar not found");
      if (!body.crowd_level && !body.line_size) return err(422, "report needs crowd_level or line_size");
      return res(201, {
        id: uuid(),
        bar_id: body.bar_id,
        near_bar: !!body.location,
        distance_bucket: body.location ? "at_door" : "unknown",
        points_awarded: body.location ? 2 : 1
      });
    }

    if (method === "POST" && p === "/v1/staff/invites/redeem") {
      if (!body.code || String(body.code).length < 8) return err(400, "Invalid or expired invite");
      state.me.role = "staff";
      state.me.staff_bar_id = BARS[0].id;
      save();
      return res(200, state.me);
    }
    if ((m = p.match(/^\/v1\/staff\/bars\/([^/]+)(\/door|\/line)?$/))) {
      if (state.me.role !== "staff" || state.me.staff_bar_id !== m[1]) return err(403, "Forbidden");
      var sb = findBar(m[1]);
      var st = staffFor(sb);
      if (method === "GET" && !m[2]) return res(200, staffState(sb));
      if (method === "POST" && m[2] === "/door") {
        var n = body.count || 1;
        if (body.direction === "in") {
          st.headcount += n;
          st.entries += n;
        } else {
          var dec = Math.min(n, st.headcount);
          st.headcount -= dec;
          st.exits += dec;
        }
        st.touched = true;
        save();
        return res(200, staffState(sb));
      }
      if (method === "POST" && m[2] === "/line") {
        st.line_size = body.line_size;
        st.line_updated_at = nowIso();
        st.touched = true;
        save();
        return res(200, staffState(sb));
      }
    }

    return err(404, "Not found");
  }

  C.mock = {
    handle: function (method, path, body) {
      return new Promise(function (resolve) {
        setTimeout(function () {
          // deep copy so callers cannot mutate mock state
          var r = route(method, path, body);
          resolve({ status: r.status, body: r.body === null ? null : JSON.parse(JSON.stringify(r.body)) });
        }, 120 + Math.random() * 120);
      });
    }
  };
})();
