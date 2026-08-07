import {
  pgTable,
  pgEnum,
  uuid,
  text,
  bigint,
  integer,
  real,
  boolean,
  date,
  timestamp,
  jsonb,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';

/* ─────────────────────────── Перечисления ─────────────────────────── */

export const localeEnum = pgEnum('locale', ['ru', 'kk']);
export const sexEnum = pgEnum('sex', ['male', 'female']);

/** Коэффициенты активности для TDEE — см. src/lib/nutrition/energy.ts */
export const activityLevelEnum = pgEnum('activity_level', [
  'sedentary', // сидячий образ жизни, ×1.2
  'light', // 1–3 тренировки в неделю, ×1.375
  'moderate', // 3–5 тренировок, ×1.55
  'high', // 6–7 тренировок, ×1.725
  'athlete', // 2 тренировки в день / физический труд, ×1.9
]);

/** Соматотип по индексу Соловьёва (обхват запястья) + обхват щиколотки */
export const bodyTypeEnum = pgEnum('body_type', [
  'ectomorph', // астеник — тонкий костяк
  'mesomorph', // нормостеник
  'endomorph', // гиперстеник — широкий костяк
]);

export const goalTypeEnum = pgEnum('goal_type', ['lose', 'maintain', 'gain']);

export const mealTypeEnum = pgEnum('meal_type', [
  'breakfast',
  'lunch',
  'dinner',
  'snack',
]);

/** Откуда взялась запись о еде */
export const entrySourceEnum = pgEnum('entry_source', [
  'photo', // распознано с фотографии
  'text', // распознано из текстового описания
  'repeat', // повтор из «моих блюд», без вызова ИИ
  'barcode', // штрихкод через Open Food Facts
  'manual', // руками из справочника
]);

export const entryStatusEnum = pgEnum('entry_status', [
  'pending', // ИИ разобрал, ждём подтверждения пользователя
  'confirmed', // пользователь подтвердил (возможно, поправив граммовку)
  'discarded', // пользователь отменил разбор
]);

/**
 * Источник данных о нутриентах — определяет доверие к цифрам и порядок
 * ранжирования в поиске.
 */
export const productSourceEnum = pgEnum('product_source', [
  'usda', // USDA FoodData Central
  'off', // Open Food Facts (штрихкоды)
  'local', // наш справочник локальной кухни
  'user', // пользователь завёл сам
  // Собрано из ингредиентов: блюда не было в справочнике целиком, модель
  // разложила его на состав, каждый ингредиент найден в USDA. Числа
  // детерминированные, но пропорции — оценка, поэтому доверие ниже.
  'derived',
]);

/* ──────────────────────────── Пользователи ─────────────────────────── */

export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** Telegram user id — приходит из подписанного initData, это наш якорь входа */
    telegramId: bigint('telegram_id', { mode: 'bigint' }).notNull(),
    username: text('username'),
    firstName: text('first_name'),
    lastName: text('last_name'),
    photoUrl: text('photo_url'),
    locale: localeEnum('locale').notNull().default('ru'),
    /** IANA-зона, например Asia/Almaty — от неё зависит граница «дня» в дневнике */
    timezone: text('timezone').notNull().default('Asia/Almaty'),
    isBlocked: boolean('is_blocked').notNull().default(false),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [uniqueIndex('users_telegram_id_idx').on(t.telegramId)],
);

/**
 * Физданные. Разделены на две группы по частоте изменения:
 *  - рост/пол/дата рождения — практически константы;
 *  - запястье и щиколотка — каркас скелета, меряются один раз при онбординге.
 * Всё, что меняется от тренировок и питания, живёт в bodyMeasurements.
 */
export const profiles = pgTable('profiles', {
  userId: uuid('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  sex: sexEnum('sex').notNull(),
  birthDate: date('birth_date').notNull(),
  heightCm: real('height_cm').notNull(),
  activityLevel: activityLevelEnum('activity_level')
    .notNull()
    .default('moderate'),

  /* Каркас — кость, не меняется ни от жира, ни от тренировок */
  wristCm: real('wrist_cm'),
  ankleCm: real('ankle_cm'),
  /** Кэш расчёта по запястью/щиколотке, чтобы не считать на каждом запросе */
  bodyType: bodyTypeEnum('body_type'),

  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/* ─────────────────────────────── Цели ──────────────────────────────── */

export const goals = pgTable(
  'goals',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    type: goalTypeEnum('type').notNull(),
    targetWeightKg: real('target_weight_kg'),
    targetDate: date('target_date'),
    /** Планируемый темп, кг/неделю. Отрицательный — похудение. */
    weeklyRateKg: real('weekly_rate_kg'),

    /* Дневные нормы. Считаются при постановке цели и пересчитываются
       еженедельно по фактической динамике веса. */
    kcalTarget: integer('kcal_target').notNull(),
    proteinTargetG: real('protein_target_g').notNull(),
    fatTargetG: real('fat_target_g').notNull(),
    carbTargetG: real('carb_target_g').notNull(),

    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index('goals_user_active_idx').on(t.userId, t.isActive)],
);

/* ──────────────────────── Вес и замеры тела ────────────────────────── */

/**
 * Ежедневный вес. Отдельно от обхватов, потому что частота другая:
 * вес — каждый день, обхваты — раз в 1–2 недели. Одна таблица на двоих
 * дала бы разреженные строки и усложнила расчёт скользящего среднего.
 */
export const weightLogs = pgTable(
  'weight_logs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** Локальная дата пользователя, не UTC — иначе утреннее взвешивание уедет на день */
    loggedOn: date('logged_on').notNull(),
    weightKg: real('weight_kg').notNull(),
    note: text('note'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex('weight_logs_user_date_idx').on(t.userId, t.loggedOn),
    index('weight_logs_user_date_desc_idx').on(t.userId, t.loggedOn.desc()),
  ],
);

/**
 * Обхваты. neck/waist/hip обязательны — они входят в формулу US Navy
 * для оценки процента жира. Остальное меряется по желанию, только ради
 * динамики: голень, например, отзывается на тренировки очень медленно.
 */
export const bodyMeasurements = pgTable(
  'body_measurements',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    measuredOn: date('measured_on').notNull(),

    /* Нужны для расчёта % жира */
    neckCm: real('neck_cm').notNull(),
    waistCm: real('waist_cm').notNull(),
    /** Обязателен для женщин: в формуле US Navy для женщин участвует обхват бёдер */
    hipCm: real('hip_cm'),

    /* Только динамика */
    chestCm: real('chest_cm'),
    bicepsCm: real('biceps_cm'),
    thighCm: real('thigh_cm'),
    calfCm: real('calf_cm'),

    /** Снапшот расчёта на момент замера — формула может измениться, история нет */
    bodyFatPct: real('body_fat_pct'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex('body_measurements_user_date_idx').on(t.userId, t.measuredOn),
  ],
);

/* ────────────────────── Справочник продуктов ───────────────────────── */

/**
 * Нутриенты берутся отсюда, а не из ответа модели: ИИ надёжно определяет,
 * ЧТО на тарелке, но выдумывает калорийность. Модель отдаёт только состав
 * и оценку веса, цифры подставляются из этой таблицы.
 */
export const products = pgTable(
  'products',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    nameRu: text('name_ru').notNull(),
    nameKk: text('name_kk'),
    nameEn: text('name_en'),
    brand: text('brand'),

    source: productSourceEnum('source').notNull(),
    /** fdcId для USDA, code для Open Food Facts */
    externalId: text('external_id'),
    barcode: text('barcode'),

    /* На 100 г продукта */
    kcalPer100g: real('kcal_per_100g').notNull(),
    proteinPer100g: real('protein_per_100g').notNull(),
    fatPer100g: real('fat_per_100g').notNull(),
    carbsPer100g: real('carbs_per_100g').notNull(),
    fiberPer100g: real('fiber_per_100g'),
    sugarPer100g: real('sugar_per_100g'),
    sodiumMgPer100g: real('sodium_mg_per_100g'),

    /** Типичная порция в граммах — подсказка для экрана подтверждения */
    defaultPortionG: real('default_portion_g'),
    /** Как назвать эту порцию: «тарелка», «кесе», «ломтик» */
    portionLabelRu: text('portion_label_ru'),
    portionLabelKk: text('portion_label_kk'),

    /** Проверено вручную — такие позиции показываем выше в поиске */
    isVerified: boolean('is_verified').notNull().default(false),
    /** Заполнено, если продукт завёл пользователь (source = 'user') */
    createdBy: uuid('created_by').references(() => users.id, {
      onDelete: 'set null',
    }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index('products_name_ru_idx').on(t.nameRu),
    index('products_barcode_idx').on(t.barcode),
    uniqueIndex('products_source_external_idx').on(t.source, t.externalId),
  ],
);

/* ───────────────────────── Дневник питания ─────────────────────────── */

export const foodEntries = pgTable(
  'food_entries',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),

    consumedAt: timestamp('consumed_at', { withTimezone: true }).notNull(),
    /** Локальная дата пользователя — по ней группируется дневник */
    consumedOn: date('consumed_on').notNull(),
    mealType: mealTypeEnum('meal_type').notNull(),

    source: entrySourceEnum('source').notNull(),
    status: entryStatusEnum('status').notNull().default('pending'),

    photoUrl: text('photo_url'),
    /** Что пользователь написал или наговорил, до разбора */
    rawInput: text('raw_input'),

    /* Сообщение бота с карточкой разбора. Нужно, чтобы приложение могло
       погасить кнопки под ним: подтвердив запись в Mini App, человек
       возвращается в чат, где всё ещё висит «✕ Отмена» — и один тап
       отправляет уже сохранённую запись в отменённые. */
    botChatId: bigint('bot_chat_id', { mode: 'number' }),
    botMessageId: integer('bot_message_id'),

    /* Отладочный след разбора: по нему можно переразобрать запись,
       если поменяем промпт или модель, и оценить качество распознавания */
    aiModel: text('ai_model'),
    aiRawResponse: jsonb('ai_raw_response'),
    aiLatencyMs: integer('ai_latency_ms'),

    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index('food_entries_user_date_idx').on(t.userId, t.consumedOn),
    index('food_entries_user_status_idx').on(t.userId, t.status),
  ],
);

/**
 * Позиция внутри приёма пищи. Нутриенты хранятся снапшотом, а не только
 * ссылкой на products: справочник со временем правится, а съеденное вчера
 * не должно задним числом менять историю.
 */
export const foodItems = pgTable(
  'food_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    entryId: uuid('entry_id')
      .notNull()
      .references(() => foodEntries.id, { onDelete: 'cascade' }),
    /** null, если ИИ распознал блюдо, но в справочнике совпадения не нашлось */
    productId: uuid('product_id').references(() => products.id, {
      onDelete: 'set null',
    }),

    /** Как модель назвала позицию — сохраняем для поиска пробелов в справочнике */
    nameRaw: text('name_raw').notNull(),
    grams: real('grams').notNull(),

    /* Снапшот на момент подтверждения */
    kcal: real('kcal').notNull(),
    proteinG: real('protein_g').notNull(),
    fatG: real('fat_g').notNull(),
    carbsG: real('carbs_g').notNull(),

    /** Уверенность модели 0..1 — низкая подсвечивается на экране подтверждения */
    aiConfidence: real('ai_confidence'),
    /** Что предложила модель до правки пользователем; расхождение = материал для калибровки */
    aiEstimatedGrams: real('ai_estimated_grams'),

    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index('food_items_entry_idx').on(t.entryId)],
);

/**
 * «Мои блюда» — то, что пользователь ест регулярно. Повторный лог такого
 * блюда идёт в один тап и не тратит вызов модели.
 */
export const favoriteMeals = pgTable(
  'favorite_meals',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    /** Состав: [{ productId, nameRaw, grams }] */
    items: jsonb('items').notNull(),
    useCount: integer('use_count').notNull().default(0),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index('favorite_meals_user_idx').on(t.userId, t.useCount.desc())],
);

/* ─────────────────────── План питания от ИИ ────────────────────────── */

export const mealPlans = pgTable(
  'meal_plans',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    goalId: uuid('goal_id').references(() => goals.id, {
      onDelete: 'set null',
    }),
    startsOn: date('starts_on').notNull(),
    endsOn: date('ends_on').notNull(),

    kcalTarget: integer('kcal_target').notNull(),
    proteinTargetG: real('protein_target_g').notNull(),
    fatTargetG: real('fat_target_g').notNull(),
    carbTargetG: real('carb_target_g').notNull(),

    /** Аллергии, непереносимости, «не ем свинину», бюджет, кухня */
    preferences: jsonb('preferences'),
    aiModel: text('ai_model'),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index('meal_plans_user_active_idx').on(t.userId, t.isActive)],
);

export const planMeals = pgTable(
  'plan_meals',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    planId: uuid('plan_id')
      .notNull()
      .references(() => mealPlans.id, { onDelete: 'cascade' }),
    /** 1..7 — день недели внутри плана */
    dayIndex: integer('day_index').notNull(),
    mealType: mealTypeEnum('meal_type').notNull(),
    title: text('title').notNull(),
    recipe: text('recipe'),
    /** Состав: [{ productId, nameRaw, grams }] */
    items: jsonb('items').notNull(),

    kcal: real('kcal').notNull(),
    proteinG: real('protein_g').notNull(),
    fatG: real('fat_g').notNull(),
    carbsG: real('carbs_g').notNull(),
  },
  (t) => [index('plan_meals_plan_day_idx').on(t.planId, t.dayIndex)],
);

/* ──────────────── Тренировки: задел на будущий этап ────────────────── */

export const workoutPlans = pgTable('workout_plans', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  /** Сколько тренировок в неделю — влияет на коэффициент активности в TDEE */
  daysPerWeek: integer('days_per_week').notNull(),
  startsOn: date('starts_on').notNull(),
  isActive: boolean('is_active').notNull().default(true),
  aiModel: text('ai_model'),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const exercises = pgTable('exercises', {
  id: uuid('id').primaryKey().defaultRandom(),
  nameRu: text('name_ru').notNull(),
  nameKk: text('name_kk'),
  /** Основная группа мышц: legs, chest, back, shoulders, arms, core */
  muscleGroup: text('muscle_group').notNull(),
  equipment: text('equipment'),
  /** Расход энергии, MET — для оценки калорий тренировки */
  metValue: real('met_value'),
});

export const workoutSessions = pgTable(
  'workout_sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    planId: uuid('plan_id').references(() => workoutPlans.id, {
      onDelete: 'set null',
    }),
    performedOn: date('performed_on').notNull(),
    durationMin: integer('duration_min'),
    note: text('note'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index('workout_sessions_user_date_idx').on(t.userId, t.performedOn)],
);

export const workoutSets = pgTable(
  'workout_sets',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sessionId: uuid('session_id')
      .notNull()
      .references(() => workoutSessions.id, { onDelete: 'cascade' }),
    exerciseId: uuid('exercise_id')
      .notNull()
      .references(() => exercises.id, { onDelete: 'restrict' }),
    setIndex: integer('set_index').notNull(),
    weightKg: real('weight_kg'),
    reps: integer('reps'),
    /** Субъективная тяжесть подхода 1..10 — по ней строится прогрессия нагрузки */
    rpe: real('rpe'),
  },
  (t) => [index('workout_sets_session_idx').on(t.sessionId)],
);

/* ─────────────────────────── Связи Drizzle ─────────────────────────── */

export const usersRelations = relations(users, ({ one, many }) => ({
  profile: one(profiles, {
    fields: [users.id],
    references: [profiles.userId],
  }),
  goals: many(goals),
  weightLogs: many(weightLogs),
  bodyMeasurements: many(bodyMeasurements),
  foodEntries: many(foodEntries),
  favoriteMeals: many(favoriteMeals),
  mealPlans: many(mealPlans),
  workoutPlans: many(workoutPlans),
  workoutSessions: many(workoutSessions),
}));

export const profilesRelations = relations(profiles, ({ one }) => ({
  user: one(users, { fields: [profiles.userId], references: [users.id] }),
}));

export const goalsRelations = relations(goals, ({ one, many }) => ({
  user: one(users, { fields: [goals.userId], references: [users.id] }),
  mealPlans: many(mealPlans),
}));

export const foodEntriesRelations = relations(foodEntries, ({ one, many }) => ({
  user: one(users, { fields: [foodEntries.userId], references: [users.id] }),
  items: many(foodItems),
}));

export const foodItemsRelations = relations(foodItems, ({ one }) => ({
  entry: one(foodEntries, {
    fields: [foodItems.entryId],
    references: [foodEntries.id],
  }),
  product: one(products, {
    fields: [foodItems.productId],
    references: [products.id],
  }),
}));

export const mealPlansRelations = relations(mealPlans, ({ one, many }) => ({
  user: one(users, { fields: [mealPlans.userId], references: [users.id] }),
  goal: one(goals, { fields: [mealPlans.goalId], references: [goals.id] }),
  meals: many(planMeals),
}));

export const planMealsRelations = relations(planMeals, ({ one }) => ({
  plan: one(mealPlans, {
    fields: [planMeals.planId],
    references: [mealPlans.id],
  }),
}));

export const workoutSessionsRelations = relations(
  workoutSessions,
  ({ one, many }) => ({
    user: one(users, {
      fields: [workoutSessions.userId],
      references: [users.id],
    }),
    plan: one(workoutPlans, {
      fields: [workoutSessions.planId],
      references: [workoutPlans.id],
    }),
    sets: many(workoutSets),
  }),
);

export const workoutSetsRelations = relations(workoutSets, ({ one }) => ({
  session: one(workoutSessions, {
    fields: [workoutSets.sessionId],
    references: [workoutSessions.id],
  }),
  exercise: one(exercises, {
    fields: [workoutSets.exerciseId],
    references: [exercises.id],
  }),
}));

/* ───────────────────────── Выводимые типы ──────────────────────────── */

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Profile = typeof profiles.$inferSelect;
export type NewProfile = typeof profiles.$inferInsert;
export type Goal = typeof goals.$inferSelect;
export type WeightLog = typeof weightLogs.$inferSelect;
export type BodyMeasurement = typeof bodyMeasurements.$inferSelect;
export type Product = typeof products.$inferSelect;
export type NewProduct = typeof products.$inferInsert;
export type FoodEntry = typeof foodEntries.$inferSelect;
export type FoodItem = typeof foodItems.$inferSelect;
export type Sex = (typeof sexEnum.enumValues)[number];
export type ActivityLevel = (typeof activityLevelEnum.enumValues)[number];
export type BodyType = (typeof bodyTypeEnum.enumValues)[number];
export type MealType = (typeof mealTypeEnum.enumValues)[number];
export type Locale = (typeof localeEnum.enumValues)[number];
