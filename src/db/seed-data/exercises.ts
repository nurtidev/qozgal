import type { InferInsertModel } from 'drizzle-orm';
import type { exercises } from '@/db/schema';

type NewExercise = InferInsertModel<typeof exercises>;

/**
 * Справочник упражнений.
 *
 * Набор намеренно небольшой: базовые движения, которые встречаются почти
 * в любой программе. Длинный список из ста вариаций одного жима мешает
 * выбирать, а редкое упражнение всё равно проще добавить, когда оно
 * действительно понадобится.
 *
 * MET — коэффициент расхода энергии из Compendium of Physical Activities.
 * Значения там заданы крупно, по типам нагрузки, а не по упражнениям:
 * силовая работа общая — 3.5, интенсивная со свободным весом — 6.0,
 * кардио — от 7 до 10 в зависимости от темпа. Мы храним ровно эту
 * градацию и не выдумываем десятые: расход в тренировке зависит от пауз
 * между подходами сильнее, чем от выбора упражнения.
 *
 * Важно: этот расход НЕ добавляется к дневной норме калорий. Норма уже
 * учитывает тренировки через коэффициент активности в TDEE, и второй учёт
 * означал бы, что человек «зарабатывает» калории, которые ему уже начислены.
 * MET показывается только справочно, на карточке тренировки.
 *
 * Казахские названия — обиходные, с общепринятыми заимствованиями для
 * инвентаря (штанга, гантель). Их стоит показать носителю: спортивная
 * терминология в казахском не устоялась, и книжный вариант может звучать
 * страннее заимствования.
 */
export const EXERCISES: NewExercise[] = [
  /* ───────────────────────────── Ноги ───────────────────────────── */
  {
    nameRu: 'Приседания со штангой',
    nameKk: 'Штангамен отырып тұру',
    muscleGroup: 'legs',
    equipment: 'штанга',
    metValue: 6,
  },
  {
    nameRu: 'Жим ногами',
    nameKk: 'Аяқпен итеру',
    muscleGroup: 'legs',
    equipment: 'тренажёр',
    metValue: 5,
  },
  {
    nameRu: 'Выпады с гантелями',
    nameKk: 'Гантельмен алға адымдау',
    muscleGroup: 'legs',
    equipment: 'гантели',
    metValue: 5,
  },
  {
    nameRu: 'Румынская тяга',
    nameKk: 'Румын тартуы',
    muscleGroup: 'legs',
    equipment: 'штанга',
    metValue: 6,
  },
  {
    nameRu: 'Разгибания ног',
    nameKk: 'Аяқты жазу',
    muscleGroup: 'legs',
    equipment: 'тренажёр',
    metValue: 3.5,
  },
  {
    nameRu: 'Сгибания ног',
    nameKk: 'Аяқты бүгу',
    muscleGroup: 'legs',
    equipment: 'тренажёр',
    metValue: 3.5,
  },
  {
    nameRu: 'Подъёмы на носки',
    nameKk: 'Ұшбасқа көтерілу',
    muscleGroup: 'legs',
    equipment: 'тренажёр',
    metValue: 3.5,
  },

  /* ──────────────────────────── Грудь ───────────────────────────── */
  {
    nameRu: 'Жим лёжа',
    nameKk: 'Жатып итеру',
    muscleGroup: 'chest',
    equipment: 'штанга',
    metValue: 6,
  },
  {
    nameRu: 'Жим гантелей лёжа',
    nameKk: 'Жатып гантель итеру',
    muscleGroup: 'chest',
    equipment: 'гантели',
    metValue: 5,
  },
  {
    nameRu: 'Жим под углом вверх',
    nameKk: 'Көлбеу орындықта итеру',
    muscleGroup: 'chest',
    equipment: 'штанга',
    metValue: 5,
  },
  {
    nameRu: 'Разведения гантелей',
    nameKk: 'Гантельді жаю',
    muscleGroup: 'chest',
    equipment: 'гантели',
    metValue: 3.5,
  },
  {
    nameRu: 'Отжимания от пола',
    nameKk: 'Еденнен көтерілу',
    muscleGroup: 'chest',
    equipment: 'без инвентаря',
    metValue: 3.8,
  },
  {
    nameRu: 'Отжимания на брусьях',
    nameKk: 'Брусьяда көтерілу',
    muscleGroup: 'chest',
    equipment: 'брусья',
    metValue: 5,
  },

  /* ──────────────────────────── Спина ───────────────────────────── */
  {
    nameRu: 'Становая тяга',
    nameKk: 'Штанганы жерден тарту',
    muscleGroup: 'back',
    equipment: 'штанга',
    metValue: 6,
  },
  {
    nameRu: 'Подтягивания',
    nameKk: 'Тартылу',
    muscleGroup: 'back',
    equipment: 'турник',
    metValue: 5,
  },
  {
    nameRu: 'Тяга штанги в наклоне',
    nameKk: 'Еңкейіп штанга тарту',
    muscleGroup: 'back',
    equipment: 'штанга',
    metValue: 5,
  },
  {
    nameRu: 'Тяга верхнего блока',
    nameKk: 'Жоғарғы блокты тарту',
    muscleGroup: 'back',
    equipment: 'тренажёр',
    metValue: 3.5,
  },
  {
    nameRu: 'Тяга гантели одной рукой',
    nameKk: 'Бір қолмен гантель тарту',
    muscleGroup: 'back',
    equipment: 'гантели',
    metValue: 3.5,
  },
  {
    nameRu: 'Гиперэкстензия',
    nameKk: 'Арқаны жазу',
    muscleGroup: 'back',
    equipment: 'тренажёр',
    metValue: 3.5,
  },

  /* ─────────────────────────── Плечи ────────────────────────────── */
  {
    nameRu: 'Жим стоя',
    nameKk: 'Тұрып итеру',
    muscleGroup: 'shoulders',
    equipment: 'штанга',
    metValue: 5,
  },
  {
    nameRu: 'Жим гантелей сидя',
    nameKk: 'Отырып гантель итеру',
    muscleGroup: 'shoulders',
    equipment: 'гантели',
    metValue: 5,
  },
  {
    nameRu: 'Махи в стороны',
    nameKk: 'Гантельді бүйірге көтеру',
    muscleGroup: 'shoulders',
    equipment: 'гантели',
    metValue: 3.5,
  },
  {
    nameRu: 'Махи в наклоне',
    nameKk: 'Еңкейіп гантель көтеру',
    muscleGroup: 'shoulders',
    equipment: 'гантели',
    metValue: 3.5,
  },
  {
    nameRu: 'Протяжка',
    nameKk: 'Штанганы иекке тарту',
    muscleGroup: 'shoulders',
    equipment: 'штанга',
    metValue: 3.5,
  },

  /* ──────────────────────────── Руки ────────────────────────────── */
  {
    nameRu: 'Подъём штанги на бицепс',
    nameKk: 'Бицепске штанга көтеру',
    muscleGroup: 'arms',
    equipment: 'штанга',
    metValue: 3.5,
  },
  {
    nameRu: 'Подъём гантелей на бицепс',
    nameKk: 'Бицепске гантель көтеру',
    muscleGroup: 'arms',
    equipment: 'гантели',
    metValue: 3.5,
  },
  {
    nameRu: 'Французский жим',
    nameKk: 'Француз итеруі',
    muscleGroup: 'arms',
    equipment: 'штанга',
    metValue: 3.5,
  },
  {
    nameRu: 'Разгибания на блоке',
    nameKk: 'Блокта қолды жазу',
    muscleGroup: 'arms',
    equipment: 'тренажёр',
    metValue: 3.5,
  },
  {
    nameRu: 'Молотковые сгибания',
    nameKk: 'Балғаша бүгу',
    muscleGroup: 'arms',
    equipment: 'гантели',
    metValue: 3.5,
  },

  /* ──────────────────────── Корпус и кор ────────────────────────── */
  {
    nameRu: 'Планка',
    nameKk: 'Тақтай тұрысы',
    muscleGroup: 'core',
    equipment: 'без инвентаря',
    metValue: 3.5,
  },
  {
    nameRu: 'Скручивания',
    nameKk: 'Іш бұлшықетін жинау',
    muscleGroup: 'core',
    equipment: 'без инвентаря',
    metValue: 3.5,
  },
  {
    nameRu: 'Подъём ног в висе',
    nameKk: 'Асылып аяқ көтеру',
    muscleGroup: 'core',
    equipment: 'турник',
    metValue: 4,
  },
  {
    nameRu: 'Боковая планка',
    nameKk: 'Бүйірлік тақтай',
    muscleGroup: 'core',
    equipment: 'без инвентаря',
    metValue: 3.5,
  },

  /* ─────────────────────────── Кардио ───────────────────────────── */
  {
    nameRu: 'Бег',
    nameKk: 'Жүгіру',
    muscleGroup: 'cardio',
    equipment: 'без инвентаря',
    metValue: 9,
  },
  {
    nameRu: 'Ходьба быстрым шагом',
    nameKk: 'Жылдам жүру',
    muscleGroup: 'cardio',
    equipment: 'без инвентаря',
    metValue: 4.3,
  },
  {
    nameRu: 'Велотренажёр',
    nameKk: 'Велотренажёр',
    muscleGroup: 'cardio',
    equipment: 'тренажёр',
    metValue: 7,
  },
  {
    nameRu: 'Гребной тренажёр',
    nameKk: 'Есу тренажёры',
    muscleGroup: 'cardio',
    equipment: 'тренажёр',
    metValue: 7,
  },
  {
    nameRu: 'Скакалка',
    nameKk: 'Секіртпе',
    muscleGroup: 'cardio',
    equipment: 'скакалка',
    metValue: 8.8,
  },
];
