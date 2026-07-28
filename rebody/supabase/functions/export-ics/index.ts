// Phase 2 — ICS 캘린더 내보내기
//
// 타임존 전략:
//   시각을 UTC로 변환하지 않는다. VTIMEZONE 블록을 넣고 TZID=Asia/Seoul + 로컬 벽시계로
//   발급한다. 어차피 DB에 벽시계로 저장돼 있으므로 변환 자체가 없으면 변환 버그도 없다.
//   (교대근무 앱에서 하루/한 시간 밀리는 사고는 대부분 이 변환에서 난다)
//
// 출력: text/calendar. 앱은 이 응답을 파일로 저장해 시스템 공유 시트로 넘긴다.

import { corsHeaders, fail, preflight } from "../_shared/http.ts";
import { adminClient, requireUser } from "../_shared/supabase.ts";
import { addDays, cycleDayIndex, crossesMidnight, type IsoDate } from "../_shared/cycle.ts";

const DEFAULT_WEEKS = 4;
const MAX_WEEKS = 12;

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;

  const user = await requireUser(req);
  if (user instanceof Response) return user;

  const url = new URL(req.url);
  const weeks = Math.min(Math.max(Number(url.searchParams.get("weeks")) || DEFAULT_WEEKS, 1), MAX_WEEKS);
  const includeFasting = url.searchParams.get("fasting") !== "false";

  const supabase = adminClient();

  const { data: pattern } = await supabase
    .from("schedule_patterns")
    .select("id, cycle_length_days, cycle_anchor_date")
    .eq("user_id", user.id)
    .eq("is_active", true)
    .maybeSingle();

  if (!pattern) return fail("not_found", "활성 스케줄이 없습니다. 먼저 온보딩을 완료해 주세요.", 404);

  const { data: cycleDays } = await supabase
    .from("schedule_cycle_days")
    .select("*")
    .eq("pattern_id", pattern.id);

  const start: IsoDate = todayInTz(user.timezone);
  const end: IsoDate = addDays(start, weeks * 7);

  const { data: overrides } = await supabase
    .from("schedule_overrides")
    .select("*")
    .eq("pattern_id", pattern.id)
    .gte("override_date", start)
    .lt("override_date", end);

  const overrideMap = new Map((overrides ?? []).map((o) => [o.override_date, o]));
  const dayMap = new Map((cycleDays ?? []).map((d) => [d.cycle_day_index, d]));

  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//ReBody//Fasting Schedule//KO",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "X-WR-CALNAME:ReBody 단식 스케줄",
    `X-WR-TIMEZONE:${user.timezone}`,
    ...vtimezoneSeoul(user.timezone),
  ];

  const stamp = icsStamp(new Date());

  for (let i = 0; i < weeks * 7; i++) {
    const date = addDays(start, i);
    const ov = overrideMap.get(date);
    const idx = cycleDayIndex(pattern.cycle_anchor_date, date, pattern.cycle_length_days);
    const day = ov ?? dayMap.get(idx);
    if (!day || day.is_off_day) continue;

    const uidBase = `${pattern.id}-${date}`;

    if (day.work_start && day.work_end) {
      lines.push(...vevent({
        uid: `work-${uidBase}@rebody.app`,
        stamp, tz: user.timezone,
        date, start: day.work_start, end: day.work_end,
        summary: "근무",
        description: "ReBody 근무 일정",
      }));
    }

    if (day.workout_start && day.workout_end) {
      lines.push(...vevent({
        uid: `workout-${uidBase}@rebody.app`,
        stamp, tz: user.timezone,
        date, start: day.workout_start, end: day.workout_end,
        summary: "운동",
        description: "ReBody 운동 일정",
      }));
    }

    if (day.suggested_meal_window_start && day.suggested_meal_window_end) {
      lines.push(...vevent({
        uid: `meal-${uidBase}@rebody.app`,
        stamp, tz: user.timezone,
        date,
        start: day.suggested_meal_window_start,
        end: day.suggested_meal_window_end,
        summary: "🍽 식사 가능 시간",
        description: "이 시간대에 식사하세요. ReBody",
      }));

      if (includeFasting) {
        // 단식 = 식사 창의 여집합. 식사 종료 → 다음 날 식사 시작.
        const nextDate = addDays(date, 1);
        const nextOv = overrideMap.get(nextDate);
        const nextIdx = cycleDayIndex(pattern.cycle_anchor_date, nextDate, pattern.cycle_length_days);
        const nextDay = nextOv ?? dayMap.get(nextIdx);
        const nextMealStart = nextDay?.suggested_meal_window_start;

        if (nextMealStart) {
          // 식사 창이 자정을 넘기면 단식 시작일도 하루 뒤가 된다.
          const fastStartDate = crossesMidnight(day.suggested_meal_window_start, day.suggested_meal_window_end)
            ? addDays(date, 1)
            : date;

          lines.push(...vevent({
            uid: `fast-${uidBase}@rebody.app`,
            stamp, tz: user.timezone,
            date: fastStartDate,
            start: day.suggested_meal_window_end,
            end: nextMealStart,
            summary: "⏳ 단식",
            description: "ReBody 단식 구간",
            // 단식 알림은 앱 푸시가 담당하므로 캘린더 알림은 끈다(중복 알림 방지).
            noAlarm: true,
            endDateOverride: nextDate,
          }));
        }
      }
    }
  }

  lines.push("END:VCALENDAR");

  return new Response(lines.join("\r\n") + "\r\n", {
    headers: {
      ...corsHeaders,
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": `attachment; filename="rebody-schedule.ics"`,
    },
  });
});

interface EventOpts {
  uid: string;
  stamp: string;
  tz: string;
  date: IsoDate;
  start: string;
  end: string;
  summary: string;
  description: string;
  noAlarm?: boolean;
  endDateOverride?: IsoDate;
}

function vevent(o: EventOpts): string[] {
  const endDate = o.endDateOverride ??
    (crossesMidnight(o.start, o.end) ? addDays(o.date, 1) : o.date);

  const out = [
    "BEGIN:VEVENT",
    `UID:${o.uid}`,
    `DTSTAMP:${o.stamp}`,
    `DTSTART;TZID=${o.tz}:${icsLocal(o.date, o.start)}`,
    `DTEND;TZID=${o.tz}:${icsLocal(endDate, o.end)}`,
    `SUMMARY:${escapeIcs(o.summary)}`,
    `DESCRIPTION:${escapeIcs(o.description)}`,
  ];

  if (!o.noAlarm) {
    out.push(
      "BEGIN:VALARM",
      "TRIGGER:-PT15M",
      "ACTION:DISPLAY",
      `DESCRIPTION:${escapeIcs(o.summary)} 15분 전`,
      "END:VALARM",
    );
  }

  out.push("END:VEVENT");
  return out;
}

/** 'YYYY-MM-DD' + 'HH:MM(:SS)' → 'YYYYMMDDTHHMMSS' (로컬, Z 없음) */
function icsLocal(date: IsoDate, time: string): string {
  const [h, m] = time.split(":");
  return `${date.replace(/-/g, "")}T${h}${m}00`;
}

function icsStamp(d: Date): string {
  return d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

function escapeIcs(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");
}

/**
 * KST는 DST가 없고 고정 +09:00이라 VTIMEZONE이 한 블록으로 끝난다.
 * 다른 타임존이면 TZID만 넣고 클라이언트 캘린더의 내장 DB에 맡긴다
 * (Google/Apple 캘린더 모두 IANA TZID를 인식한다).
 */
function vtimezoneSeoul(tz: string): string[] {
  if (tz !== "Asia/Seoul") return [];
  return [
    "BEGIN:VTIMEZONE",
    "TZID:Asia/Seoul",
    "BEGIN:STANDARD",
    "DTSTART:19700101T000000",
    "TZOFFSETFROM:+0900",
    "TZOFFSETTO:+0900",
    "TZNAME:KST",
    "END:STANDARD",
    "END:VTIMEZONE",
  ];
}

/** 서버 UTC가 아니라 사용자 타임존의 '오늘'부터 내보낸다. */
function todayInTz(tz: string): IsoDate {
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit",
    }).format(new Date());
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}
