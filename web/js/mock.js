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
  // FAKE specials. Days are Monday = 0. Ages are hours since "posted".
  var SPECIAL_SEED = {
    "fake-tipsy-owl": [
      ["happy_hour", "FAKE Happy Hour", "Half price wells and drafts", [0, 1, 2, 3, 4], "17:00", "20:00", null, "staff", 5],
      ["cover", "FAKE Cover", "Cash or card", [3, 4, 5], "21:00", "02:00", 500, "staff", 30],
      ["food", "FAKE Wing Night", "Ten wings", [2], "18:00", "22:00", 700, "staff", 52]
    ],
    "fake-copper-lantern": [
      ["cover", "FAKE Cover", "Every night", [0, 1, 2, 3, 4, 5, 6], "18:00", "02:00", 300, "admin", 70],
      ["event", "FAKE Trivia", "Teams of up to six", [1], "20:00", "22:00", null, "staff", 8]
    ],
    "fake-night-heron": []
  };
  var MAX_SPECIALS = 30;
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

  // ---------- specials ----------
  function specialsFor(bar) {
    if (!state.specials) state.specials = {};
    if (!state.specials[bar.id]) {
      state.specials[bar.id] = (SPECIAL_SEED[bar.slug] || []).map(function (r) {
        return {
          id: uuid(),
          kind: r[0],
          title: r[1],
          details: r[2],
          days: r[3],
          start_local: r[4],
          end_local: r[5],
          price_cents: r[6],
          is_active: true,
          posted_by: r[7],
          updated_at: new Date(Date.now() - r[8] * 3600000).toISOString()
        };
      });
    }
    return state.specials[bar.id];
  }

  function sortedSpecials(bar, activeOnly) {
    return specialsFor(bar)
      .filter(function (sp) {
        return !activeOnly || sp.is_active;
      })
      .slice()
      .sort(function (a, b) {
        var da = Math.min.apply(null, a.days);
        var db = Math.min.apply(null, b.days);
        if (da !== db) return da - db;
        if (a.start_local !== b.start_local) return a.start_local < b.start_local ? -1 : 1;
        return a.title < b.title ? -1 : 1;
      });
  }

  function mins(hhmm) {
    return Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3));
  }

  // Same rules as the backend: a night runs noon to noon and belongs to the weekday it began on.
  function specialsTonight(bar) {
    var now = new Date();
    var nightStart = new Date(now.getTime() - (now.getHours() < 12 ? 86400000 : 0));
    var nightDay = (nightStart.getDay() + 6) % 7;
    var today = (now.getDay() + 6) % 7;
    var yesterday = (today + 6) % 7;
    var nowMin = now.getHours() * 60 + now.getMinutes();
    var out = [];
    sortedSpecials(bar, true).forEach(function (sp) {
      if (sp.days.indexOf(nightDay) === -1) return;
      var a = mins(sp.start_local);
      var b = mins(sp.end_local);
      var overnight = b <= a;
      var isNow = false;
      if (sp.days.indexOf(today) !== -1 && (overnight ? nowMin >= a : nowMin >= a && nowMin < b)) isNow = true;
      if (overnight && sp.days.indexOf(yesterday) !== -1 && nowMin < b) isNow = true;
      var copy = JSON.parse(JSON.stringify(sp));
      copy.is_now = isNow;
      out.push(copy);
    });
    out.sort(function (x, y) {
      if (x.is_now !== y.is_now) return x.is_now ? -1 : 1;
      return x.start_local < y.start_local ? -1 : x.start_local > y.start_local ? 1 : 0;
    });
    return out;
  }

  function summary(bar) {
    var lv = live(bar);
    var tonight = specialsTonight(bar);
    var cover = null;
    tonight.forEach(function (sp) {
      if (!cover && sp.kind === "cover") cover = sp;
    });
    return {
      id: bar.id,
      slug: bar.slug,
      name: bar.name,
      address: bar.address,
      capacity: bar.capacity,
      pass_price_cents: bar.pass_price_cents,
      live: lv,
      verdict: verdict(bar, lv),
      specials_tonight: tonight,
      cover_tonight: cover
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
    s.specials_week = sortedSpecials(bar, true);
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

  function validateSpecial(b, partial) {
    var hhmm = /^([01][0-9]|2[0-3]):[0-5][0-9]$/;
    if (!partial || "title" in b) {
      if (typeof b.title !== "string" || b.title.length < 1) return "title_required";
      if (b.title.length > 80) return "title must be at most 80 characters";
    }
    if (!partial || "kind" in b) {
      if (["happy_hour", "drink", "food", "cover", "event"].indexOf(b.kind) === -1) return "kind_required";
    }
    if (!partial || "days" in b) {
      if (!Array.isArray(b.days) || !b.days.length) return "days_required";
      if (b.days.some(function (d, i) { return d < 0 || d > 6 || b.days.indexOf(d) !== i; })) return "days must be unique";
    }
    if ((!partial || "start_local" in b) && !hhmm.test(b.start_local || "")) return "time must be HH:MM, 24 hour";
    if ((!partial || "end_local" in b) && !hhmm.test(b.end_local || "")) return "time must be HH:MM, 24 hour";
    if (b.price_cents !== null && b.price_cents !== undefined && (b.price_cents < 0 || b.price_cents > 100000)) return "price_cents must be 0 to 100000";
    return null;
  }

  function specialsRoute(method, bar, id, body) {
    var list = specialsFor(bar);
    var i;
    if (method === "GET" && !id) return res(200, sortedSpecials(bar, false));
    if (method === "POST" && !id) {
      var bad = validateSpecial(body, false);
      if (bad) return err(422, bad);
      if (body.start_local === body.end_local) return err(422, "start and end must differ");
      if (list.length >= MAX_SPECIALS) return err(409, "too_many_specials");
      var row = {
        id: uuid(),
        kind: body.kind,
        title: body.title,
        details: body.details || "",
        days: body.days.slice().sort(),
        start_local: body.start_local,
        end_local: body.end_local,
        price_cents: body.price_cents === undefined ? null : body.price_cents,
        is_active: true,
        posted_by: "staff",
        updated_at: nowIso()
      };
      list.push(row);
      save();
      return res(201, row);
    }
    for (i = 0; i < list.length; i++) if (list[i].id === id) break;
    if (!id || i === list.length) return err(404, "not_found");
    if (method === "PATCH") {
      var bad2 = validateSpecial(body, true);
      if (bad2) return err(422, bad2);
      var next = Object.assign({}, list[i], body);
      if (next.start_local === next.end_local) return err(422, "start_equals_end");
      next.days = next.days.slice().sort();
      next.updated_at = nowIso();
      list[i] = next;
      save();
      return res(200, next);
    }
    if (method === "DELETE") {
      list.splice(i, 1);
      save();
      return res(204);
    }
    return err(404, "Not found");
  }

  // ---------- door code and line samples ----------
  // FAKE rotating code. Changes every 2 minutes. The current and the previous code both work.
  var CODE_MS = 120000;
  function codeFor(barId, bucket) {
    var seed = 0;
    for (var i = 0; i < barId.length; i++) seed = (seed * 31 + barId.charCodeAt(i)) % 9973;
    var n = (bucket * 7919 + seed * 131 + 1234) % 10000;
    return String(n).padStart(4, "0");
  }
  function codeMatches(barId, code) {
    if (!/^\d{4}$/.test(code || "")) return false;
    var b = Math.floor(Date.now() / CODE_MS);
    return code === codeFor(barId, b) || code === codeFor(barId, b - 1);
  }
  function sampleOut(x) {
    return {
      id: x.id,
      bar_id: x.bar_id,
      status: x.status,
      started_at: x.started_at,
      ended_at: x.ended_at,
      predicted_wait_min: x.predicted_wait_min,
      actual_wait_min: x.actual_wait_min
    };
  }
  function samplesFor() {
    if (!state.samples) state.samples = [];
    return state.samples;
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
        verified: false,
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
      state.session.verified = state.session.status === "completed" && codeMatches(state.session.bar_id, body.door_code);
      state.session.points_awarded = state.session.status === "completed" ? (state.session.verified ? 20 : 10) : 0;
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
    if ((m = p.match(/^\/v1\/staff\/bars\/([^/]+)\/specials(?:\/([^/]+))?$/))) {
      if (state.me.role !== "staff" || state.me.staff_bar_id !== m[1]) return err(403, "Forbidden");
      return specialsRoute(method, findBar(m[1]), m[2], body);
    }
    if ((m = p.match(/^\/v1\/staff\/bars\/([^/]+)\/(door-code|count-sync|line-samples(?:\/active)?|line-samples\/([^/]+)\/end)$/))) {
      if (state.me.role !== "staff" || state.me.staff_bar_id !== m[1]) return err(403, "Forbidden");
      var tb = findBar(m[1]);
      var tst = staffFor(tb);
      var list = samplesFor();
      if (method === "GET" && m[2] === "door-code") {
        var now = Date.now();
        return res(200, { code: codeFor(tb.id, Math.floor(now / CODE_MS)), expires_in: Math.max(1, Math.ceil((CODE_MS - (now % CODE_MS)) / 1000)) });
      }
      if (method === "POST" && m[2] === "count-sync") {
        var target = body.inside_now;
        if (typeof target !== "number" || target < 0 || target > 5000) return err(422, "inside_now must be 0 to 5000");
        var delta = target - tst.headcount;
        tst.headcount = target;
        if (delta > 0) tst.entries += delta;
        else tst.exits += -delta;
        tst.touched = true;
        save();
        return res(200, staffState(tb));
      }
      if (method === "GET" && m[2] === "line-samples/active") {
        return res(200, list.filter(function (x) { return x.bar_id === tb.id && x.status === "active"; }).map(sampleOut));
      }
      if (method === "POST" && m[2] === "line-samples") {
        var act = list.filter(function (x) { return x.bar_id === tb.id && x.status === "active"; });
        if (act.length >= 2) return err(409, "too_many_samples");
        var smp = {
          id: uuid(),
          bar_id: tb.id,
          status: "active",
          started_at: nowIso(),
          ended_at: null,
          predicted_wait_min: live(tb).wait_min,
          actual_wait_min: null
        };
        list.push(smp);
        save();
        return res(201, sampleOut(smp));
      }
      if (method === "POST" && m[3]) {
        var found = null;
        list.forEach(function (x) {
          if (x.id === m[3] && x.bar_id === tb.id) found = x;
        });
        if (!found) return err(404, "not_found");
        if (found.status !== "active") return err(409, "sample_not_active");
        var endAt = new Date();
        var waited = (endAt.getTime() - new Date(found.started_at).getTime()) / 60000;
        found.ended_at = endAt.toISOString();
        found.status = body.outcome === "inside" ? "completed" : "abandoned";
        found.actual_wait_min = found.status === "completed" ? Math.round(waited * 10) / 10 : null;
        save();
        return res(200, sampleOut(found));
      }
      return err(404, "Not found");
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
