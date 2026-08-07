import { z } from 'zod';
import { eq, desc } from 'drizzle-orm';

import { route, parseBody, dateSchema } from '@/lib/api';
import { AuthError } from '@/lib/auth';
import { db } from '@/db';
import { bodyMeasurements } from '@/db/schema';
import { localDate } from '@/db/queries';
import { calcBodyFatPct } from '@/lib/health/composition';

const postSchema = z.object({
  measuredOn: dateSchema.optional(),

  // Нужны для расчёта процента жира по методу US Navy
  neckCm: z.number().min(20).max(80),
  waistCm: z.number().min(40).max(200),
  /** Обязателен для женщин: у них обхват бёдер входит в формулу */
  hipCm: z.number().min(50).max(200).nullable().optional(),

  // Только для динамики, в расчётах не участвуют
  chestCm: z.number().min(50).max(200).nullable().optional(),
  bicepsCm: z.number().min(15).max(80).nullable().optional(),
  thighCm: z.number().min(30).max(120).nullable().optional(),
  calfCm: z.number().min(20).max(80).nullable().optional(),
});

export const POST = route(async ({ session, request }) => {
  const { user, profile } = session;
  if (!profile) {
    throw new AuthError('Сначала заполните физические данные', 428);
  }

  const body = await parseBody(request, postSchema);

  if (profile.sex === 'female' && (body.hipCm == null || body.hipCm <= 0)) {
    return Response.json(
      {
        error: 'Нужен обхват бёдер',
        fields: { hipCm: 'Для женщин обхват бёдер входит в формулу расчёта' },
      },
      { status: 422 },
    );
  }

  const bodyFatPct = calcBodyFatPct({
    sex: profile.sex,
    heightCm: profile.heightCm,
    neckCm: body.neckCm,
    waistCm: body.waistCm,
    hipCm: body.hipCm,
  });

  const date = body.measuredOn ?? localDate(user.timezone);

  const [saved] = await db
    .insert(bodyMeasurements)
    .values({
      userId: user.id,
      measuredOn: date,
      neckCm: body.neckCm,
      waistCm: body.waistCm,
      hipCm: body.hipCm ?? null,
      chestCm: body.chestCm ?? null,
      bicepsCm: body.bicepsCm ?? null,
      thighCm: body.thighCm ?? null,
      calfCm: body.calfCm ?? null,
      bodyFatPct,
    })
    .onConflictDoUpdate({
      target: [bodyMeasurements.userId, bodyMeasurements.measuredOn],
      set: {
        neckCm: body.neckCm,
        waistCm: body.waistCm,
        hipCm: body.hipCm ?? null,
        chestCm: body.chestCm ?? null,
        bicepsCm: body.bicepsCm ?? null,
        thighCm: body.thighCm ?? null,
        calfCm: body.calfCm ?? null,
        bodyFatPct,
      },
    })
    .returning();

  return Response.json({
    ok: true,
    measuredOn: saved.measuredOn,
    bodyFatPct,
    // null означает, что обхваты вне диапазона применимости формулы —
    // честнее сказать «не посчитали», чем показать выдуманное число
    bodyFatNote:
      bodyFatPct === null
        ? 'Не удалось рассчитать процент жира — проверьте обхваты шеи и талии'
        : null,
  });
});

export const GET = route(async ({ session }) => {
  const rows = await db
    .select()
    .from(bodyMeasurements)
    .where(eq(bodyMeasurements.userId, session.user.id))
    .orderBy(desc(bodyMeasurements.measuredOn))
    .limit(60);

  return Response.json({
    measurements: rows.map((m) => ({
      measuredOn: m.measuredOn,
      neckCm: m.neckCm,
      waistCm: m.waistCm,
      hipCm: m.hipCm,
      chestCm: m.chestCm,
      bicepsCm: m.bicepsCm,
      thighCm: m.thighCm,
      calfCm: m.calfCm,
      bodyFatPct: m.bodyFatPct,
    })),
  });
});
