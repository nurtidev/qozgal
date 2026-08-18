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
 * loadsAreas — какие области тела нагружает движение. По ним упражнение
 * сопоставляется с травмами: поясницу нагружают и становая (спина), и
 * приседания (ноги), и гиперэкстензия — движения из разных групп мышц,
 * объединённые не мышцей, а тем, на что ложится нагрузка. Разметка сделана
 * по типовой технике движения и намеренно с запасом: пропустить опасное
 * хуже, чем лишний раз предупредить. Её стоит показать тренеру.
 *
 * pattern — паттерн движения. Из него собирается программа тренировок:
 * день описан не списком упражнений, а последовательностью паттернов
 * («присед, горизонтальный жим, горизонтальная тяга, кор»), и под каждый
 * подбирается доступное упражнение. Отсюда же берётся взаимозаменяемость:
 * если жим лёжа отпал из-за плеча, замену ищут среди других h_push, а не
 * среди «упражнений на грудь» — разведения гантелей грудь нагружают, но
 * жим не заменяют.
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
    pattern: 'squat',
    loadsAreas: ['knee', 'lower_back', 'hip'],
  },
  {
    nameRu: 'Жим ногами',
    nameKk: 'Аяқпен итеру',
    muscleGroup: 'legs',
    equipment: 'тренажёр',
    metValue: 5,
    pattern: 'squat',
    loadsAreas: ['knee', 'lower_back', 'hip'],
  },
  {
    nameRu: 'Выпады с гантелями',
    nameKk: 'Гантельмен алға адымдау',
    muscleGroup: 'legs',
    equipment: 'гантели',
    metValue: 5,
    pattern: 'lunge',
    loadsAreas: ['knee', 'hip', 'ankle'],
  },
  {
    nameRu: 'Румынская тяга',
    nameKk: 'Румын тартуы',
    muscleGroup: 'legs',
    equipment: 'штанга',
    metValue: 6,
    pattern: 'hinge',
    loadsAreas: ['lower_back', 'hip'],
  },
  {
    nameRu: 'Приседания с гантелями',
    nameKk: 'Гантельмен отырып тұру',
    muscleGroup: 'legs',
    equipment: 'гантели',
    metValue: 5,
    pattern: 'squat',
    loadsAreas: ['knee', 'lower_back', 'hip'],
  },
  {
    nameRu: 'Румынская тяга с гантелями',
    nameKk: 'Гантельмен румын тартуы',
    muscleGroup: 'legs',
    equipment: 'гантели',
    metValue: 5,
    pattern: 'hinge',
    loadsAreas: ['lower_back', 'hip'],
  },
  {
    nameRu: 'Ягодичный мостик',
    nameKk: 'Жамбасты көтеру',
    muscleGroup: 'legs',
    equipment: 'без инвентаря',
    metValue: 3.5,
    pattern: 'ham_iso',
    loadsAreas: ['lower_back', 'hip'],
  },
  {
    nameRu: 'Разгибания ног',
    nameKk: 'Аяқты жазу',
    muscleGroup: 'legs',
    equipment: 'тренажёр',
    metValue: 3.5,
    pattern: 'quad_iso',
    loadsAreas: ['knee'],
  },
  {
    nameRu: 'Сгибания ног',
    nameKk: 'Аяқты бүгу',
    muscleGroup: 'legs',
    equipment: 'тренажёр',
    metValue: 3.5,
    pattern: 'ham_iso',
    loadsAreas: ['knee'],
  },
  {
    nameRu: 'Подъёмы на носки',
    nameKk: 'Ұшбасқа көтерілу',
    muscleGroup: 'legs',
    equipment: 'тренажёр',
    metValue: 3.5,
    pattern: 'calf',
    loadsAreas: ['ankle'],
  },
  {
    nameRu: 'Подъёмы на носки стоя',
    nameKk: 'Тұрып ұшбасқа көтерілу',
    muscleGroup: 'legs',
    equipment: 'без инвентаря',
    metValue: 3.5,
    pattern: 'calf',
    loadsAreas: ['ankle'],
  },

  /* ──────────────────────────── Грудь ───────────────────────────── */
  {
    nameRu: 'Жим лёжа',
    nameKk: 'Жатып итеру',
    muscleGroup: 'chest',
    equipment: 'штанга',
    metValue: 6,
    pattern: 'h_push',
    loadsAreas: ['shoulder', 'elbow', 'wrist'],
  },
  {
    nameRu: 'Жим гантелей лёжа',
    nameKk: 'Жатып гантель итеру',
    muscleGroup: 'chest',
    equipment: 'гантели',
    metValue: 5,
    pattern: 'h_push',
    loadsAreas: ['shoulder', 'elbow', 'wrist'],
  },
  {
    nameRu: 'Жим под углом вверх',
    nameKk: 'Көлбеу орындықта итеру',
    muscleGroup: 'chest',
    equipment: 'штанга',
    metValue: 5,
    pattern: 'h_push',
    loadsAreas: ['shoulder', 'elbow', 'wrist'],
  },
  {
    nameRu: 'Разведения гантелей',
    nameKk: 'Гантельді жаю',
    muscleGroup: 'chest',
    equipment: 'гантели',
    metValue: 3.5,
    pattern: 'chest_iso',
    loadsAreas: ['shoulder'],
  },
  {
    nameRu: 'Отжимания от пола',
    nameKk: 'Еденнен көтерілу',
    muscleGroup: 'chest',
    equipment: 'без инвентаря',
    metValue: 3.8,
    pattern: 'h_push',
    loadsAreas: ['shoulder', 'elbow', 'wrist'],
  },
  {
    nameRu: 'Отжимания на брусьях',
    nameKk: 'Брусьяда көтерілу',
    muscleGroup: 'chest',
    equipment: 'брусья',
    metValue: 5,
    pattern: 'h_push',
    loadsAreas: ['shoulder', 'elbow', 'wrist'],
  },

  /* ──────────────────────────── Спина ───────────────────────────── */
  {
    nameRu: 'Становая тяга',
    nameKk: 'Штанганы жерден тарту',
    muscleGroup: 'back',
    equipment: 'штанга',
    metValue: 6,
    pattern: 'hinge',
    loadsAreas: ['lower_back', 'hip', 'knee'],
  },
  {
    nameRu: 'Подтягивания',
    nameKk: 'Тартылу',
    muscleGroup: 'back',
    equipment: 'турник',
    metValue: 5,
    pattern: 'v_pull',
    loadsAreas: ['shoulder', 'elbow'],
  },
  {
    nameRu: 'Тяга штанги в наклоне',
    nameKk: 'Еңкейіп штанга тарту',
    muscleGroup: 'back',
    equipment: 'штанга',
    metValue: 5,
    pattern: 'h_pull',
    loadsAreas: ['lower_back', 'shoulder', 'elbow'],
  },
  {
    nameRu: 'Тяга верхнего блока',
    nameKk: 'Жоғарғы блокты тарту',
    muscleGroup: 'back',
    equipment: 'тренажёр',
    metValue: 3.5,
    pattern: 'v_pull',
    loadsAreas: ['shoulder', 'elbow'],
  },
  {
    nameRu: 'Тяга гантели одной рукой',
    nameKk: 'Бір қолмен гантель тарту',
    muscleGroup: 'back',
    equipment: 'гантели',
    metValue: 3.5,
    pattern: 'h_pull',
    loadsAreas: ['shoulder', 'elbow'],
  },
  {
    nameRu: 'Гиперэкстензия',
    nameKk: 'Арқаны жазу',
    muscleGroup: 'back',
    equipment: 'тренажёр',
    metValue: 3.5,
    pattern: 'hinge',
    loadsAreas: ['lower_back', 'hip'],
  },

  /* ─────────────────────────── Плечи ────────────────────────────── */
  {
    nameRu: 'Жим стоя',
    nameKk: 'Тұрып итеру',
    muscleGroup: 'shoulders',
    equipment: 'штанга',
    metValue: 5,
    pattern: 'v_push',
    loadsAreas: ['shoulder', 'elbow', 'lower_back', 'neck'],
  },
  {
    nameRu: 'Жим гантелей сидя',
    nameKk: 'Отырып гантель итеру',
    muscleGroup: 'shoulders',
    equipment: 'гантели',
    metValue: 5,
    pattern: 'v_push',
    loadsAreas: ['shoulder', 'elbow', 'neck'],
  },
  {
    nameRu: 'Махи в стороны',
    nameKk: 'Гантельді бүйірге көтеру',
    muscleGroup: 'shoulders',
    equipment: 'гантели',
    metValue: 3.5,
    pattern: 'delt_iso',
    loadsAreas: ['shoulder'],
  },
  {
    nameRu: 'Махи в наклоне',
    nameKk: 'Еңкейіп гантель көтеру',
    muscleGroup: 'shoulders',
    equipment: 'гантели',
    metValue: 3.5,
    pattern: 'delt_iso',
    loadsAreas: ['shoulder', 'lower_back', 'neck'],
  },
  {
    nameRu: 'Протяжка',
    nameKk: 'Штанганы иекке тарту',
    muscleGroup: 'shoulders',
    equipment: 'штанга',
    metValue: 3.5,
    pattern: 'delt_iso',
    loadsAreas: ['shoulder', 'neck', 'wrist'],
  },

  /* ──────────────────────────── Руки ────────────────────────────── */
  {
    nameRu: 'Подъём штанги на бицепс',
    nameKk: 'Бицепске штанга көтеру',
    muscleGroup: 'arms',
    equipment: 'штанга',
    metValue: 3.5,
    pattern: 'biceps',
    loadsAreas: ['elbow', 'wrist'],
  },
  {
    nameRu: 'Подъём гантелей на бицепс',
    nameKk: 'Бицепске гантель көтеру',
    muscleGroup: 'arms',
    equipment: 'гантели',
    metValue: 3.5,
    pattern: 'biceps',
    loadsAreas: ['elbow', 'wrist'],
  },
  {
    nameRu: 'Французский жим',
    nameKk: 'Француз итеруі',
    muscleGroup: 'arms',
    equipment: 'штанга',
    metValue: 3.5,
    pattern: 'triceps',
    loadsAreas: ['elbow', 'shoulder', 'wrist'],
  },
  {
    nameRu: 'Разгибания на блоке',
    nameKk: 'Блокта қолды жазу',
    muscleGroup: 'arms',
    equipment: 'тренажёр',
    metValue: 3.5,
    pattern: 'triceps',
    loadsAreas: ['elbow'],
  },
  {
    nameRu: 'Отжимания узким хватом',
    nameKk: 'Тар ұстап көтерілу',
    muscleGroup: 'arms',
    equipment: 'без инвентаря',
    metValue: 3.8,
    pattern: 'triceps',
    loadsAreas: ['elbow', 'shoulder', 'wrist'],
  },
  {
    nameRu: 'Молотковые сгибания',
    nameKk: 'Балғаша бүгу',
    muscleGroup: 'arms',
    equipment: 'гантели',
    metValue: 3.5,
    pattern: 'biceps',
    loadsAreas: ['elbow', 'wrist'],
  },

  /* ──────────────────────── Корпус и кор ────────────────────────── */
  {
    nameRu: 'Планка',
    nameKk: 'Тақтай тұрысы',
    muscleGroup: 'core',
    equipment: 'без инвентаря',
    metValue: 3.5,
    pattern: 'core',
    loadsAreas: ['lower_back', 'shoulder', 'wrist'],
  },
  {
    nameRu: 'Скручивания',
    nameKk: 'Іш бұлшықетін жинау',
    muscleGroup: 'core',
    equipment: 'без инвентаря',
    metValue: 3.5,
    pattern: 'core',
    loadsAreas: ['neck', 'lower_back'],
  },
  {
    nameRu: 'Подъём ног в висе',
    nameKk: 'Асылып аяқ көтеру',
    muscleGroup: 'core',
    equipment: 'турник',
    metValue: 4,
    pattern: 'core',
    loadsAreas: ['lower_back', 'shoulder'],
  },
  {
    nameRu: 'Боковая планка',
    nameKk: 'Бүйірлік тақтай',
    muscleGroup: 'core',
    equipment: 'без инвентаря',
    metValue: 3.5,
    pattern: 'core',
    loadsAreas: ['shoulder', 'lower_back', 'wrist'],
  },

  /* ─────────────────────────── Кардио ───────────────────────────── */
  {
    nameRu: 'Бег',
    nameKk: 'Жүгіру',
    muscleGroup: 'cardio',
    equipment: 'без инвентаря',
    metValue: 9,
    pattern: 'cardio',
    loadsAreas: ['knee', 'ankle', 'hip', 'lower_back'],
  },
  {
    nameRu: 'Ходьба быстрым шагом',
    nameKk: 'Жылдам жүру',
    muscleGroup: 'cardio',
    equipment: 'без инвентаря',
    metValue: 4.3,
    pattern: 'cardio',
    loadsAreas: [],
  },
  {
    nameRu: 'Велотренажёр',
    nameKk: 'Велотренажёр',
    muscleGroup: 'cardio',
    equipment: 'тренажёр',
    metValue: 7,
    pattern: 'cardio',
    loadsAreas: ['knee'],
  },
  {
    nameRu: 'Гребной тренажёр',
    nameKk: 'Есу тренажёры',
    muscleGroup: 'cardio',
    equipment: 'тренажёр',
    metValue: 7,
    pattern: 'cardio',
    loadsAreas: ['lower_back', 'knee', 'shoulder'],
  },
  {
    nameRu: 'Скакалка',
    nameKk: 'Секіртпе',
    muscleGroup: 'cardio',
    equipment: 'скакалка',
    metValue: 8.8,
    pattern: 'cardio',
    loadsAreas: ['ankle', 'knee', 'lower_back'],
  },
  /* ──────────────── Домашние варианты и замены ────────────────── */

  /**
   * Эти карточки добавлены не для полноты справочника, а потому что без
   * них половина приложения не работала.
   *
   * Замер: в программе на четыре дня дома выпадал слот изоляции квадрицепса
   * (разгибания есть только на тренажёре), а замена упражнения не работала
   * в десяти паттернах из шестнадцати — там был единственный вариант, и
   * кнопка ничего не меняла. В зале то же в трёх паттернах: выпад, изоляция
   * квадрицепса и грудь.
   *
   * Поэтому здесь ровно то, что закрывает пробел: движения с собственным
   * весом, гантелями и турником, по одному-двум на паттерн. Это не отмена
   * правила «набор небольшой» — вариаций одного жима по-прежнему не будет.
   */

  {
    nameRu: 'Приседания с собственным весом',
    nameKk: 'Дене салмағымен отырып тұру',
    muscleGroup: 'legs',
    equipment: 'без инвентаря',
    metValue: 3.8,
    pattern: 'squat',
    loadsAreas: ['knee', 'hip'],
  },
  {
    nameRu: 'Болгарские приседания',
    nameKk: 'Болгар отырып тұруы',
    muscleGroup: 'legs',
    equipment: 'гантели',
    metValue: 5,
    pattern: 'squat',
    loadsAreas: ['knee', 'hip', 'ankle'],
  },
  {
    nameRu: 'Выпады без инвентаря',
    nameKk: 'Құралсыз алға адымдау',
    muscleGroup: 'legs',
    equipment: 'без инвентаря',
    metValue: 3.8,
    pattern: 'lunge',
    loadsAreas: ['knee', 'hip', 'ankle'],
  },
  {
    nameRu: 'Обратные выпады с гантелями',
    nameKk: 'Гантельмен артқа адымдау',
    muscleGroup: 'legs',
    equipment: 'гантели',
    metValue: 5,
    pattern: 'lunge',
    // Колену в обратном выпаде достаётся меньше, чем в переднем, но
    // разметка идёт с запасом: пропустить опасное хуже, чем предупредить
    loadsAreas: ['knee', 'hip', 'ankle'],
  },
  {
    nameRu: 'Румынская тяга на одной ноге',
    nameKk: 'Бір аяқпен румын тартуы',
    muscleGroup: 'legs',
    equipment: 'гантели',
    metValue: 5,
    pattern: 'hinge',
    loadsAreas: ['lower_back', 'hip', 'ankle'],
  },
  {
    nameRu: 'Обратная гиперэкстензия на полу',
    nameKk: 'Еденде кері гиперэкстензия',
    muscleGroup: 'legs',
    equipment: 'без инвентаря',
    metValue: 3.5,
    pattern: 'hinge',
    loadsAreas: ['lower_back', 'hip'],
  },
  {
    nameRu: 'Присед у стены',
    nameKk: 'Қабырғаға сүйеніп отыру',
    muscleGroup: 'legs',
    equipment: 'без инвентаря',
    metValue: 3.5,
    pattern: 'quad_iso',
    loadsAreas: ['knee'],
  },
  {
    nameRu: 'Разгибание ног с гантелью',
    nameKk: 'Гантельмен аяқты жазу',
    muscleGroup: 'legs',
    equipment: 'гантели',
    metValue: 3.5,
    pattern: 'quad_iso',
    loadsAreas: ['knee'],
  },
  {
    nameRu: 'Ягодичный мостик на одной ноге',
    nameKk: 'Бір аяқпен жамбасты көтеру',
    muscleGroup: 'legs',
    equipment: 'без инвентаря',
    metValue: 3.5,
    pattern: 'ham_iso',
    loadsAreas: ['lower_back', 'hip'],
  },
  {
    nameRu: 'Подъёмы на носки с гантелями',
    nameKk: 'Гантельмен ұшбасқа көтерілу',
    muscleGroup: 'legs',
    equipment: 'гантели',
    metValue: 3.5,
    pattern: 'calf',
    loadsAreas: ['ankle'],
  },
  {
    nameRu: 'Пуловер с гантелью',
    nameKk: 'Гантельмен пуловер',
    muscleGroup: 'chest',
    equipment: 'гантели',
    metValue: 3.5,
    pattern: 'chest_iso',
    loadsAreas: ['shoulder', 'lower_back'],
  },
  {
    nameRu: 'Подтягивания обратным хватом',
    nameKk: 'Кері ұстап тартылу',
    muscleGroup: 'back',
    equipment: 'турник',
    metValue: 6,
    pattern: 'v_pull',
    loadsAreas: ['shoulder', 'elbow'],
  },
  {
    nameRu: 'Тяга двух гантелей в наклоне',
    nameKk: 'Еңкейіп екі гантель тарту',
    muscleGroup: 'back',
    equipment: 'гантели',
    metValue: 5,
    pattern: 'h_pull',
    loadsAreas: ['lower_back', 'shoulder', 'elbow'],
  },
  {
    nameRu: 'Австралийские подтягивания',
    nameKk: 'Көлбеу тартылу',
    muscleGroup: 'back',
    equipment: 'турник',
    metValue: 5,
    pattern: 'h_pull',
    loadsAreas: ['shoulder', 'elbow'],
  },
  {
    nameRu: 'Отжимания в стойке у стены',
    nameKk: 'Қабырғаға сүйеніп тік көтерілу',
    muscleGroup: 'shoulders',
    equipment: 'без инвентаря',
    metValue: 5,
    pattern: 'v_push',
    loadsAreas: ['shoulder', 'elbow', 'wrist', 'neck'],
  },
  {
    nameRu: 'Жим гантели одной рукой стоя',
    nameKk: 'Бір қолмен тұрып гантель итеру',
    muscleGroup: 'shoulders',
    equipment: 'гантели',
    metValue: 5,
    pattern: 'v_push',
    loadsAreas: ['shoulder', 'elbow', 'lower_back'],
  },
  {
    nameRu: 'Обратные отжимания от опоры',
    nameKk: 'Тіректен кері көтерілу',
    muscleGroup: 'arms',
    equipment: 'без инвентаря',
    metValue: 3.8,
    pattern: 'triceps',
    loadsAreas: ['elbow', 'shoulder', 'wrist'],
  },
  {
    nameRu: 'Разгибание гантели из-за головы',
    nameKk: 'Бас артынан гантель жазу',
    muscleGroup: 'arms',
    equipment: 'гантели',
    metValue: 3.5,
    pattern: 'triceps',
    loadsAreas: ['elbow', 'shoulder'],
  },
  /* ──────────── Отведение и приведение бедра, икры в жиме ─────────── */

  /**
   * Добавлено по живому журналу: человек сделал абдуктор, аддуктор и икры
   * в тренажёре для жима ногами, а записать их было нечем — таких карточек
   * в справочнике не существовало, и часть тренировки осталась вне учёта.
   */
  {
    nameRu: 'Отведение бедра в тренажёре',
    nameKk: 'Жаттықтырғышта жамбасты сыртқа ашу',
    muscleGroup: 'legs',
    equipment: 'тренажёр',
    metValue: 3.5,
    pattern: 'hip_iso',
    loadsAreas: ['hip'],
  },
  {
    nameRu: 'Сведение бедра в тренажёре',
    nameKk: 'Жаттықтырғышта жамбасты ішке жию',
    muscleGroup: 'legs',
    equipment: 'тренажёр',
    metValue: 3.5,
    pattern: 'hip_iso',
    loadsAreas: ['hip'],
  },
  {
    // Дома паттерн иначе выпадал бы целиком: тренажёра нет, а движение
    // делается лёжа на боку без всякого инвентаря
    nameRu: 'Отведение ноги лёжа на боку',
    nameKk: 'Бүйірде жатып аяқты көтеру',
    muscleGroup: 'legs',
    equipment: 'без инвентаря',
    metValue: 3.5,
    pattern: 'hip_iso',
    loadsAreas: ['hip'],
  },
  {
    // Тот же паттерн, что «Подъёмы на носки», но в жиме ногами: вес там
    // считается по стеку тренажёра, и сравнивать его с подъёмами стоя
    // бессмысленно — приложение сравнивает человека с ним же самим
    nameRu: 'Подъём на носки в жиме ногами',
    nameKk: 'Аяқпен итеруде ұшбасқа көтерілу',
    muscleGroup: 'legs',
    equipment: 'тренажёр',
    metValue: 3.5,
    pattern: 'calf',
    loadsAreas: ['ankle', 'knee'],
  },
];
