import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  /**
   * Значок разработки не рисуется поверх страницы: проверка вёрстки идёт
   * скриншотами, а он садится ровно в левый нижний угол — туда же, где
   * у экранов кнопки удаления и подсказки. На готовой сборке его и так нет.
   */
  devIndicators: false,
};

export default nextConfig;
