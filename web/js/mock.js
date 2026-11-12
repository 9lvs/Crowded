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
      drink: "10_to_20",
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
      drink: "5_to_10",
      counts_exits: false,
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
  // Row: kind, title, details, days, start, end, price_cents, posted_by, age, all_day, items.
  // Item: name, price_label, category, note. Mirrors the backend seed shape.
  var EVERY = [0, 1, 2, 3, 4, 5, 6];
  var SPECIAL_SEED = {
    "fake-tipsy-owl": [
      ["drink", "FAKE All Night Drafts", "Every night", EVERY, "12:00", "04:00", null, "staff", 5, true, [["FAKE Lager drafts", "$3", "beer", ""]]],
      [
        "happy_hour", "FAKE Owl Hour", "Every night 9 to 11 PM", EVERY, "21:00", "23:00", null, "staff", 5, false,
        [
          ["FAKE Regular drafts", "$3", "beer", ""],
          ["FAKE House shots", "$3", "shots", ""],
          ["FAKE House wine", "$3", "wine", ""],
          ["FAKE 32oz pitchers", "$5", "pitchers", ""]
        ]
      ],
      ["event", "FAKE DJ Night", "DJ on the floor", EVERY, "21:00", "02:00", null, "staff", 8, false, []],
      ["food", "FAKE Wing Night", "Wednesday dinner", [2], "18:00", "22:00", null, "staff", 52, false, [["FAKE Ten wings", "$7", "food", "Dine in only"]]],
      ["cover", "FAKE Cover", "Cash or card", [3, 4, 5], "21:00", "02:00", 500, "staff", 30, false, []]
    ],
    "fake-copper-lantern": [
      ["cover", "FAKE Cover", "Every night", EVERY, "18:00", "02:00", 300, "admin", 70, false, []],
      ["event", "FAKE Trivia", "Teams of up to six", [1], "20:00", "22:00", null, "staff", 8, false, []]
    ],
    "fake-night-heron": []
  };
  var MAX_SPECIALS = 30;
  var DRINK_LABELS = { under_5: "Under 5 min", "5_to_10": "5 to 10 min", "10_to_20": "10 to 20 min", over_20: "Over 20 min" };
  var CROWD_VALUES = ["easy", "busy", "packed"];
  var DRINK_VALUES = ["under_5", "5_to_10", "10_to_20", "over_20"];
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

  // Admin console changes survive a reload of the tab. Custom bars live in state.customBars and
  // edits to the built in bars live in state.barEdits.
  (state.customBars || []).forEach(function (cb) {
    BARS.push(cb);
  });
  Object.keys(state.barEdits || {}).forEach(function (id) {
    var eb = findBar(id);
    if (eb) Object.assign(eb, state.barEdits[id]);
  });

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
        line_updated_at: bar.hasData ? new Date(Date.now() - 6 * 60000).toISOString() : null,
        counts_exits: bar.counts_exits !== false,
        inside: null,
        inside_updates: 0
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
        drink_wait: null,
        drink_wait_label: null,
        confidence: "none",
        basis: { text: "No recent data", window_min: 30, reports: 0, timers: 0, door_events: 0, staff_line_updates: 0, inside_updates: 0 },
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
    parts.push(st.counts_exits === false ? "staff entries" : "staff counts");
    if (st.inside) parts.push("1 inside update");
    var crowd = crowdFrom(ratio);
    if (st.inside && st.inside.crowd_level) crowd = st.inside.crowd_level;
    var drink = st.inside && st.inside.drink_wait ? st.inside.drink_wait : bar.hasData ? bar.drink || null : null;
    var joined = parts.length > 1 ? parts.slice(0, -1).join(", ") + " and " + parts[parts.length - 1] : parts[0];
    return {
      has_recent_data: true,
      wait_min: wait,
      wait_low_min: Math.round(wait * 0.75),
      wait_high_min: Math.round(wait * 1.3),
      crowd_level: crowd,
      headcount: st.counts_exits === false ? null : st.headcount,
      capacity_ratio: st.counts_exits === false ? null : Math.round(ratio * 100) / 100,
      drink_wait: drink,
      drink_wait_label: drink ? DRINK_LABELS[drink] : null,
      confidence: bar.timers >= 2 ? "high" : "medium",
      basis: {
        text: "Based on " + joined + " in the last 30 min",
        window_min: 30,
        reports: bar.reports,
        timers: bar.timers,
        door_events: 24,
        staff_line_updates: 1,
        inside_updates: st.inside ? 1 : 0
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
          all_day: r[9],
          items: r[10].map(function (i) {
            return { name: i[0], price_label: i[1], category: i[2], note: i[3] };
          }),
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
      staff_level: null,
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
      counts_exits: st.counts_exits !== false,
      inside: st.inside,
      live: live(bar)
    };
  }

  function res(status, body) {
    return { status: status, body: body === undefined ? null : body };
  }

  function err(status, detail) {
    return res(status, { detail: detail });
  }

  function invalid(msg, loc) {
    return res(422, { detail: "validation_error", errors: [{ loc: loc || ["body"], msg: msg, type: "value_error" }] });
  }

  // Items and all_day rules, like the backend. Returns a response or null.
  function validateDeals(b) {
    if (b.items !== undefined && b.items !== null) {
      if (!Array.isArray(b.items)) return invalid("Input should be a valid list", ["body", "items"]);
      if (b.items.length > 20) return invalid("List should have at most 20 items after validation, not " + b.items.length, ["body", "items"]);
      for (var i = 0; i < b.items.length; i++) {
        var it = b.items[i];
        if (!it.name) return invalid("String should have at least 1 character", ["body", "items", i, "name"]);
        if (it.name.length > 60) return invalid("String should have at most 60 characters", ["body", "items", i, "name"]);
        if (!it.price_label) return invalid("String should have at least 1 character", ["body", "items", i, "price_label"]);
        if (it.price_label.length > 20) return invalid("String should have at most 20 characters", ["body", "items", i, "price_label"]);
        if (["beer", "pitchers", "shots", "mixers", "wine", "food", "other"].indexOf(it.category) === -1) {
          return invalid("Input should be a valid category", ["body", "items", i, "category"]);
        }
      }
    }
    return null;
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
      if (body.all_day) {
        body.start_local = "12:00";
        body.end_local = "04:00";
      } else if (!body.start_local || !body.end_local) {
        return invalid("Value error, times_required");
      }
      var badDeals = validateDeals(body);
      if (badDeals) return badDeals;
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
        all_day: !!body.all_day,
        items: (body.items || []).map(function (i) {
          return { name: i.name, price_label: i.price_label, category: i.category, note: i.note || "" };
        }),
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
      var badDeals2 = validateDeals(body);
      if (badDeals2) return badDeals2;
      var bad2 = validateSpecial(body, true);
      if (bad2) return err(422, bad2);
      var next = Object.assign({}, list[i], body);
      if (next.all_day) {
        next.start_local = "12:00";
        next.end_local = "04:00";
      }
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

  // ---------- line samples ----------
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

  function isManager() {
    return state.me.role === "admin" || (state.me.role === "staff" && state.me.staff_level === "manager");
  }
  function canStaff(barId) {
    if (state.me.role === "admin") return true;
    return state.me.role === "staff" && state.me.staff_bar_id === barId;
  }

  // ---------- admin console ----------
  var CODE_CHARS = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

  function adminOut(x) {
    return {
      id: x.id,
      slug: x.slug,
      name: x.name,
      address: x.address,
      latitude: x.latitude,
      longitude: x.longitude,
      capacity: x.capacity,
      timezone: x.timezone || "America/New_York",
      is_active: x.is_active !== false,
      counts_exits: staffFor(x).counts_exits !== false
    };
  }

  function auditList() {
    if (!state.audit) {
      state.audit = [
        { ts: new Date(Date.now() - 26 * 3600000).toISOString(), actor_role: "admin", action: "pass_price.set", target_type: "bar", target_id: BARS[0].id, bar_id: BARS[0].id, details: { price_cents: 1500 } },
        { ts: new Date(Date.now() - 50 * 3600000).toISOString(), actor_role: "admin", action: "invite.create", target_type: "invite", target_id: uuid(), bar_id: BARS[1].id, details: { level: "manager" } }
      ];
    }
    return state.audit;
  }

  function addAudit(action, targetType, targetId, barId, details) {
    auditList().unshift({ ts: nowIso(), actor_role: "admin", action: action, target_type: targetType, target_id: targetId, bar_id: barId || null, details: details || {} });
    state.audit = state.audit.slice(0, 500);
  }

  function editBar(bar, changes) {
    Object.assign(bar, changes);
    var custom = (state.customBars || []).indexOf(bar) !== -1;
    if (!custom) {
      if (!state.barEdits) state.barEdits = {};
      state.barEdits[bar.id] = Object.assign(state.barEdits[bar.id] || {}, changes);
    }
  }

  function numberIn(v, lo, hi) {
    return typeof v === "number" && isFinite(v) && v >= lo && v <= hi;
  }

  function adminRoute(method, p, body) {
    if (state.me.role !== "admin") return err(403, "forbidden");
    var m;
    var i;
    if (!state.adminStaff) {
      state.adminStaff = {};
      state.adminStaff[BARS[0].id] = [
        { user_id: uuid(), bar_id: BARS[0].id, level: "manager", phone_hint: "ending in 42", created_at: new Date(Date.now() - 9 * 86400000).toISOString() },
        { user_id: uuid(), bar_id: BARS[0].id, level: "door", phone_hint: "ending in 17", created_at: new Date(Date.now() - 2 * 86400000).toISOString() }
      ];
    }

    if (p === "/v1/admin/bars") {
      if (method === "GET") return res(200, BARS.map(adminOut));
      if (method === "POST") {
        var bad = [];
        if (typeof body.name !== "string" || !body.name.trim() || body.name.length > 120) bad.push("name");
        if (typeof body.slug !== "string" || !/^[a-z0-9-]{2,64}$/.test(body.slug)) bad.push("slug");
        if (!numberIn(body.latitude, -90, 90)) bad.push("latitude");
        if (!numberIn(body.longitude, -180, 180)) bad.push("longitude");
        if (!numberIn(body.capacity, 1, 10000) || Math.floor(body.capacity) !== body.capacity) bad.push("capacity");
        if (body.timezone !== undefined && !/^[A-Za-z_]+(\/[A-Za-z_]+)?$/.test(body.timezone)) bad.push("timezone");
        if (bad.length) {
          return res(422, {
            detail: "validation_error",
            errors: bad.map(function (f) {
              return { loc: ["body", f], msg: "invalid", type: "value_error" };
            })
          });
        }
        for (i = 0; i < BARS.length; i++) if (BARS[i].slug === body.slug) return err(409, "slug_taken");
        var nb = {
          id: uuid(),
          slug: body.slug,
          name: body.name.trim(),
          address: body.address || "",
          latitude: body.latitude,
          longitude: body.longitude,
          capacity: body.capacity,
          timezone: body.timezone || "America/New_York",
          is_active: true,
          counts_exits: true,
          pass_price_cents: null,
          baseWait: 0,
          swing: 0,
          baseFill: 0,
          reports: 0,
          timers: 0,
          hasData: false,
          typical: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0]
        };
        if (!state.customBars) state.customBars = [];
        state.customBars.push(nb);
        BARS.push(nb);
        addAudit("bar.create", "bar", nb.id, nb.id, { slug: nb.slug });
        save();
        return res(201, adminOut(nb));
      }
    }

    if (method === "GET" && p === "/v1/admin/metrics/accuracy") {
      var fake = [
        [14, 3.4, 1.2],
        [6, 2.1, -0.8]
      ];
      return res(
        200,
        BARS.map(function (x, idx) {
          var row = fake[idx];
          return {
            bar_id: x.id,
            bar_name: x.name,
            samples: row ? row[0] : 0,
            mean_abs_error_min: row ? row[1] : null,
            mean_bias_min: row ? row[2] : null
          };
        })
      );
    }
    if (method === "GET" && p === "/v1/admin/audit") return res(200, auditList().slice(0, 100));

    if ((m = p.match(/^\/v1\/admin\/invites\/([^/]+)\/revoke$/)) && method === "POST") {
      var inv = (state.invites || {})[m[1]];
      if (!inv) return err(404, "not_found");
      inv.revoked = true;
      addAudit("invite.revoke", "invite", m[1], inv.bar_id, {});
      save();
      return res(204);
    }

    if ((m = p.match(/^\/v1\/admin\/bars\/([^/]+)(?:\/(pass-price|invites|staff))?(?:\/([^/]+))?$/))) {
      var bar = findBar(m[1]);
      if (!bar) return err(404, "not_found");
      if (!m[2] && method === "PATCH") {
        var changes = {};
        if (body.name !== undefined && body.name !== null) {
          if (typeof body.name !== "string" || !body.name.trim() || body.name.length > 120) return invalid("invalid name", ["body", "name"]);
          changes.name = body.name.trim();
        }
        if (body.address !== undefined && body.address !== null) changes.address = String(body.address).slice(0, 200);
        if (body.capacity !== undefined && body.capacity !== null) {
          if (!numberIn(body.capacity, 1, 10000)) return invalid("invalid capacity", ["body", "capacity"]);
          changes.capacity = body.capacity;
        }
        if (typeof body.is_active === "boolean") changes.is_active = body.is_active;
        if (typeof body.counts_exits === "boolean") {
          changes.counts_exits = body.counts_exits;
          staffFor(bar).counts_exits = body.counts_exits;
        }
        editBar(bar, changes);
        addAudit("bar.update", "bar", bar.id, bar.id, changes);
        save();
        return res(200, adminOut(bar));
      }
      if (m[2] === "pass-price" && method === "PUT") {
        var cents = body.price_cents;
        if (cents !== null && (!numberIn(cents, 0, 100000) || Math.floor(cents) !== cents)) return invalid("invalid price", ["body", "price_cents"]);
        editBar(bar, { pass_price_cents: cents });
        addAudit("pass_price.set", "bar", bar.id, bar.id, { price_cents: cents });
        save();
        return res(200, { bar_id: bar.id, price_cents: cents, currency: "usd", created_at: nowIso() });
      }
      if (m[2] === "invites" && method === "POST") {
        var level = body.level === "manager" ? "manager" : "door";
        var raw = "";
        for (i = 0; i < 5; i++) raw += CODE_CHARS.charAt(Math.floor(Math.random() * CODE_CHARS.length));
        var iid = uuid();
        if (!state.invites) state.invites = {};
        state.invites[iid] = { bar_id: bar.id, level: level, revoked: false };
        addAudit("invite.create", "invite", iid, bar.id, { level: level });
        save();
        return res(201, {
          id: iid,
          bar_id: bar.id,
          level: level,
          code: (level === "manager" ? "MANAGER-" : "DOOR-") + raw,
          expires_at: new Date(Date.now() + 3 * 86400000).toISOString()
        });
      }
      if (m[2] === "staff") {
        var members = state.adminStaff[bar.id] || [];
        if (method === "GET" && !m[3]) return res(200, members);
        if (method === "DELETE" && m[3]) {
          for (i = 0; i < members.length; i++) if (members[i].user_id === m[3]) break;
          if (i === members.length) return err(404, "not_found");
          members.splice(i, 1);
          addAudit("staff.remove", "user", m[3], bar.id, {});
          save();
          return res(204);
        }
      }
    }
    return err(404, "Not found");
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
      // FAKE admin: a phone ending in 0001 signs in as an admin, like the seeded dev admin.
      if (/0001$/.test(digits)) {
        state.me.role = "admin";
        state.me.staff_level = null;
        state.me.staff_bar_id = null;
      }
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

    if (method === "GET" && p === "/v1/bars") {
      return res(
        200,
        BARS.filter(function (x) {
          return x.is_active !== false;
        }).map(summary)
      );
    }
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
      state.session.points_awarded = state.session.status === "completed" ? 10 : 0;
      state.points += state.session.points_awarded;
      var out = state.session;
      save();
      return res(200, out);
    }

    if (method === "POST" && p === "/v1/reports") {
      if (!findBar(body.bar_id)) return err(404, "Bar not found");
      if (!body.crowd_level && !body.line_size && !body.drink_wait) return err(422, "report needs crowd_level, line_size or drink_wait");
      if (body.drink_wait && DRINK_VALUES.indexOf(body.drink_wait) === -1) return err(422, "unknown drink_wait");
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
      // Demo codes: any 8+ characters. MANAGER... makes a manager. ADMIN... makes an admin. ENTRY... joins the count in only bar.
      var up = String(body.code).toUpperCase();
      if (up.indexOf("ADMIN") === 0) {
        state.me.role = "admin";
        state.me.staff_level = null;
        state.me.staff_bar_id = null;
        save();
        return res(200, state.me);
      }
      state.me.role = "staff";
      state.me.staff_level = up.indexOf("MANAGER") === 0 ? "manager" : "door";
      state.me.staff_bar_id = (up.indexOf("ENTRY") === 0 ? BARS[1] : BARS[0]).id;
      save();
      return res(200, state.me);
    }
    if (p.indexOf("/v1/admin/") === 0) return adminRoute(method, p, body);
    if ((m = p.match(/^\/v1\/staff\/bars\/([^/]+)\/specials(?:\/([^/]+))?$/))) {
      if (!canStaff(m[1])) return err(403, "Forbidden");
      if (!isManager()) return err(403, "manager_only");
      return specialsRoute(method, findBar(m[1]), m[2], body);
    }
    if ((m = p.match(/^\/v1\/staff\/bars\/([^/]+)\/(door-code|count-sync|line-samples(?:\/active)?|line-samples\/([^/]+)\/end)$/))) {
      if (!canStaff(m[1])) return err(403, "Forbidden");
      var tb = findBar(m[1]);
      var tst = staffFor(tb);
      var list = samplesFor();
      if (method === "GET" && m[2] === "door-code") return err(404, "door_code_disabled");
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
    if ((m = p.match(/^\/v1\/staff\/bars\/([^/]+)(\/door|\/line|\/inside|\/settings)?$/))) {
      if (!canStaff(m[1])) return err(403, "Forbidden");
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
      if (method === "POST" && m[2] === "/inside") {
        if (!body.crowd_level && !body.drink_wait) return err(422, "report needs crowd_level or drink_wait");
        if (body.crowd_level && CROWD_VALUES.indexOf(body.crowd_level) === -1) return err(422, "unknown crowd_level");
        if (body.drink_wait && DRINK_VALUES.indexOf(body.drink_wait) === -1) return err(422, "unknown drink_wait");
        var prev = st.inside || { crowd_level: null, drink_wait: null };
        st.inside = {
          crowd_level: body.crowd_level || prev.crowd_level,
          drink_wait: body.drink_wait || prev.drink_wait,
          updated_at: nowIso()
        };
        st.inside_updates = (st.inside_updates || 0) + 1;
        st.touched = true;
        save();
        return res(200, staffState(sb));
      }
      if (method === "PATCH" && m[2] === "/settings") {
        if (!isManager()) return err(403, "manager_only");
        if (typeof body.counts_exits !== "boolean") return err(422, "counts_exits must be true or false");
        st.counts_exits = body.counts_exits;
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
