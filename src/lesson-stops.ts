/** Per-lesson slider stops from Enjoy Life Forever. Outro bundles Some people say, Summary, and Review. */
export interface LessonStops {
	review: boolean;
	points?: number;
	questions?: number;
}

export const LESSON_STOPS: ReadonlyMap<string, LessonStops> = new Map([
	["How Can the Bible Help You?", { review: false, points: 6 }],
	["The Bible Gives Hope", { review: false, points: 5 }],
	["Can You Trust the Bible?", { review: false, points: 6 }],
	["Who Is God?", { review: false, points: 5 }],
	["The Bible Is God’s Message to Us", { review: false, points: 6 }],
	["How Did Life Begin?", { review: false, points: 6 }],
	["What Is Jehovah Like?", { review: false, points: 7 }],
	["You Can Be Jehovah’s Friend", { review: false, points: 7 }],
	["Draw Close to God Through Prayer", { review: false, points: 7 }],
	["How Can the Meetings of Jehovah’s Witnesses Benefit You?", { review: false, points: 5 }],
	["How You Can Get the Most Out of the Bible", { review: false, points: 5 }],
	["What Will Help You to Keep Studying the Bible?", { review: false, points: 6 }],
	["Section 1 Review", { review: true, questions: 10 }],
	["How False Religion Misrepresents God", { review: false, points: 7 }],
	["How Can Our Worship Be Pleasing to God?", { review: false, points: 7 }],
	["Who Is Jesus?", { review: false, points: 6 }],
	["What Did Jesus Do While on Earth?", { review: false, points: 6 }],
	["What Is Jesus Like?", { review: false, points: 6 }],
	["How to Identify Real Christians", { review: false, points: 7 }],
	["Are Jehovah’s Witnesses Real Christians?", { review: false, points: 6 }],
	["How the Congregation Is Organized", { review: false, points: 6 }],
	["How Is the Good News Being Preached?", { review: false, points: 6 }],
	["How Can You Share the Good News?", { review: false, points: 5 }],
	["Baptism—A Worthwhile Goal!", { review: false, points: 6 }],
	["What Is the Truth About Angels?", { review: false, points: 6 }],
	["What Is God’s Purpose for Us?", { review: false, points: 5 }],
	["Why Do Evil and Suffering Exist?", { review: false, points: 7 }],
	["How Can Jesus’ Death Save Us?", { review: false, points: 5 }],
	["Show Appreciation for What Jehovah and Jesus Did for You", { review: false, points: 5 }],
	["What Happens When We Die?", { review: false, points: 5 }],
	["Your Loved Ones Can Live Again!", { review: false, points: 6 }],
	["What Is God’s Kingdom?", { review: false, points: 7 }],
	["God’s Kingdom Now Rules!", { review: false, points: 6 }],
	["What the Kingdom Will Accomplish", { review: false, points: 6 }],
	["Section 2 Review", { review: true, questions: 15 }],
	["How Can We Show Our Love for Jehovah?", { review: false, points: 6 }],
	["How to Make Good Decisions", { review: false, points: 5 }],
	["Be Honest in All Things", { review: false, points: 6 }],
	["What the Bible Says About Work and Money", { review: false, points: 6 }],
	["Appreciate the Gift of Life", { review: false, points: 5 }],
	["God’s View of Blood", { review: false, points: 5 }],
	["How Can We Be Clean in God’s Eyes?", { review: false, points: 5 }],
	["What Does the Bible Say About Sex?", { review: false, points: 5 }],
	["What Does the Bible Say About Singleness and Marriage?", { review: false, points: 7 }],
	["How Should Christians View Alcohol?", { review: false, points: 6 }],
	["Do All Celebrations Please God?", { review: false, points: 6 }],
	["What It Means to Be Neutral", { review: false, points: 4 }],
	["Why Make a Dedication and Get Baptized?", { review: false, points: 5 }],
	["Are You Ready to Get Baptized?", { review: false, points: 7 }],
	["Section 3 Review", { review: true, questions: 12 }],
	["Choose Your Friends Wisely", { review: false, points: 5 }],
	["How Can Your Family Be Happy?—Part 1", { review: false, points: 6 }],
	["How Can Your Family Be Happy?—Part 2", { review: false, points: 7 }],
	["How Can You Please Jehovah With Your Speech?", { review: false, points: 6 }],
	["Why Our Clothing and Appearance Matter", { review: false, points: 5 }],
	["Choose Entertainment That Pleases Jehovah", { review: false, points: 5 }],
	["The Role of “the Faithful and Discreet Slave”", { review: false, points: 5 }],
	["Support Your Local Congregation", { review: false, points: 5 }],
	["Maintain Unity in the Congregation", { review: false, points: 6 }],
	["What if You Commit a Serious Sin?", { review: false, points: 5 }],
	["Remain Loyal to Jehovah", { review: false, points: 5 }],
	["You Can Endure Persecution", { review: false, points: 6 }],
	["Continue Making Progress", { review: false, points: 6 }],
	["Section 4 Review", { review: true, questions: 12 }],
]);

export const OUTRO_PART = 'Outro';

const CLOSING = new Set(['outro', 'summary', 'review', 'some people say', 'someone may ask']);

export function isClosingPart(part: string): boolean {
	return CLOSING.has(part.trim().toLowerCase());
}

function lookupStops(title: string): LessonStops | undefined {
	const bare = title.trim().replace(/^\d+\s+/, '');
	const direct = LESSON_STOPS.get(title.trim()) ?? LESSON_STOPS.get(bare);
	if (direct) return direct;
	const wanted = bare.toLowerCase();
	for (const [name, spec] of LESSON_STOPS) {
		if (name.toLowerCase() === wanted) return spec;
	}
	return undefined;
}

export function sliderStopsFor(title: string, fallback: readonly string[]): readonly string[] {
	const spec = lookupStops(title);
	if (!spec) return fallback;
	if (spec.review) {
		const count = spec.questions ?? 10;
		return Array.from({ length: count }, (_, index) => String(index + 1));
	}
	const points = spec.points ?? 0;
	return ['Intro', ...Array.from({ length: points }, (_, index) => String(index + 1)), OUTRO_PART];
}

/** "Lesson 12, point 3" / "Lesson 12, Intro" / "Lesson 12, Outro". Reviews use question numbers. */
export function formatLessonLine(title: string, part: string): string {
	const number = /^(\d+)\s+/.exec(title.trim())?.[1];
	const lesson = number ? `Lesson ${Number(number)}` : title.trim();
	const stop = part.trim();
	if (!stop) return lesson;
	if (/^\d+$/.test(stop)) {
		const spec = lookupStops(title);
		return spec?.review ? `${lesson}, question ${stop}` : `${lesson}, point ${stop}`;
	}
	return `${lesson}, ${stop}`;
}

/** "Done through 3" and "Next time: point 4". Intro and Outro keep their names. */
export function partwayCopy(parts: readonly string[], index: number): { done: string; next: string } {
	const current = parts[Math.max(0, Math.min(index, parts.length - 1))] ?? '';
	const following = parts[index + 1];
	const done = `Done through ${current}`;
	if (!following) return { done, next: 'Next time: the next lesson' };
	const next = /^\d+$/.test(following) ? `Next time: point ${following}` : `Next time: ${following}`;
	return { done, next };
}

/** 0–100 slider position to 1–90 days. Coarser steps toward the long end. */
export function sliderToSnoozeDays(position: number): number {
	const t = Math.min(1, Math.max(0, position / 100));
	const days = 1 + Math.round(t * t * 89);
	return Math.min(90, Math.max(1, days));
}

export function snoozeDaysToSlider(days: number): number {
	const clamped = Math.min(90, Math.max(1, Math.round(days)));
	const t = Math.sqrt((clamped - 1) / 89);
	return Math.round(t * 100);
}
