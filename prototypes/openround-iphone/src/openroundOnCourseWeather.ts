import type { WeatherSnapshot } from "./openroundOnCourseModel.ts";

export type WeatherLocation = {
  lat: number;
  lon: number;
};

export type WeatherPort = (
  location: WeatherLocation,
  signal?: AbortSignal,
) => Promise<WeatherSnapshot>;

function weatherConditionLabel(code: number): string {
  if (code === 0) return "Clear";
  if (code <= 3) return "Partly cloudy";
  if (code <= 48) return "Foggy";
  if (code <= 57) return "Drizzle";
  if (code <= 67) return "Rain";
  if (code <= 77) return "Snow";
  if (code <= 82) return "Rain showers";
  if (code <= 86) return "Snow showers";
  return "Thunderstorms";
}

function isValidLocation(location: WeatherLocation): boolean {
  return Number.isFinite(location.lat)
    && Number.isFinite(location.lon)
    && location.lat >= -90
    && location.lat <= 90
    && location.lon >= -180
    && location.lon <= 180;
}

function isValidWeatherNumber(value: number, minimum: number, maximum: number): boolean {
  return Number.isFinite(value) && value >= minimum && value <= maximum;
}

export function createOpenMeteoWeatherPort(fetcher?: typeof fetch): WeatherPort {
  const request = fetcher ?? (typeof fetch === "function" ? fetch : undefined);
  return async (location, signal) => {
    if (!request) throw new Error("Weather fetch unavailable");
    if (!isValidLocation(location)) throw new Error("Weather location invalid");

    const params = new URLSearchParams({
      latitude: location.lat.toFixed(5),
      longitude: location.lon.toFixed(5),
      current: "temperature_2m,wind_speed_10m,weather_code",
      daily: "temperature_2m_max,temperature_2m_min",
      forecast_days: "1",
      temperature_unit: "fahrenheit",
      wind_speed_unit: "mph",
      timezone: "auto",
    });
    const response = await request(
      `https://api.open-meteo.com/v1/forecast?${params.toString()}`,
      signal ? { signal } : undefined,
    );
    if (!response.ok) throw new Error("Weather unavailable");

    const payload = await response.json() as unknown;
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new Error("Weather payload invalid");
    const record = payload as Record<string, unknown>;
    const current = record.current;
    const daily = record.daily;
    if (!current || typeof current !== "object" || Array.isArray(current) || !daily || typeof daily !== "object" || Array.isArray(daily)) {
      throw new Error("Weather payload incomplete");
    }

    const currentRecord = current as Record<string, unknown>;
    const dailyRecord = daily as Record<string, unknown>;
    const temperatureF = Number(currentRecord.temperature_2m);
    const windMph = Number(currentRecord.wind_speed_10m);
    const weatherCode = Number(currentRecord.weather_code);
    const highF = Number(Array.isArray(dailyRecord.temperature_2m_max) ? dailyRecord.temperature_2m_max[0] : Number.NaN);
    const lowF = Number(Array.isArray(dailyRecord.temperature_2m_min) ? dailyRecord.temperature_2m_min[0] : Number.NaN);
    if (!isValidWeatherNumber(temperatureF, -40, 140)
      || !isValidWeatherNumber(windMph, 0, 60)
      || !isValidWeatherNumber(weatherCode, 0, 200)
      || !isValidWeatherNumber(highF, -40, 160)
      || !isValidWeatherNumber(lowF, -80, 140)
      || highF < lowF) {
      throw new Error("Weather values invalid");
    }

    return {
      source: "live",
      capturedAt: new Date().toISOString(),
      temperatureF: Math.round(temperatureF),
      highF: Math.round(highF),
      lowF: Math.round(lowF),
      windMph: Math.round(windMph),
      windDirection: "crosswind",
      condition: weatherConditionLabel(Math.round(weatherCode)),
      forecast: "Local forecast refreshed for this phone location",
    } satisfies WeatherSnapshot;
  };
}

export const defaultOpenMeteoWeatherPort = createOpenMeteoWeatherPort();
