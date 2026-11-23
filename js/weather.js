// Weather from Open-Meteo (free, no key). Only used when DECK_CONFIG.WEATHER has coordinates.
var Weather = (function () {
  var DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  // WMO weather codes → short words that fit the small layouts.
  function describe(code) {
    if (code === 0) return 'Clear';
    if (code <= 2) return 'Partly cloudy';
    if (code === 3) return 'Cloudy';
    if (code === 45 || code === 48) return 'Fog';
    if (code >= 51 && code <= 57) return 'Drizzle';
    if ((code >= 61 && code <= 67) || (code >= 80 && code <= 82)) return 'Rain';
    if ((code >= 71 && code <= 77) || code === 85 || code === 86) return 'Snow';
    if (code >= 95) return 'Storms';
    return '';
  }

  function configured() {
    var w = DECK_CONFIG.WEATHER;
    return !!(w && typeof w.lat === 'number' && typeof w.lon === 'number');
  }

  function get() {
    var w = DECK_CONFIG.WEATHER;
    var url = 'https://api.open-meteo.com/v1/forecast?latitude=' + w.lat + '&longitude=' + w.lon +
      '&current=temperature_2m,weather_code' +
      '&daily=temperature_2m_max,temperature_2m_min,weather_code,sunset' +
      '&temperature_unit=' + (w.units || 'fahrenheit') + '&timezone=auto&forecast_days=4';
    return fetch(url, { cache: 'no-store' }).then(function (res) {
      if (!res.ok) throw new Error('weather ' + res.status);
      return res.json();
    }).then(function (d) {
      var daily = d.daily || {};
      var days = [];
      for (var i = 1; i < 4 && daily.time && i < daily.time.length; i++) {
        // "2026-11-24" parsed as a local date, so the weekday is right in every timezone.
        var parts = daily.time[i].split('-');
        var date = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
        days.push({
          day: DAYS[date.getDay()],
          temp: Math.round(daily.temperature_2m_max[i]),
          desc: describe(daily.weather_code[i]).replace('Partly cloudy', 'Clouds')
        });
      }
      // Sunset comes back as local "2026-11-23T16:38": keep just the clock part.
      var sunset = daily.sunset && daily.sunset[0] ? daily.sunset[0].split('T')[1] : '';
      return {
        temp: Math.round(d.current.temperature_2m),
        desc: describe(d.current.weather_code),
        hi: Math.round(daily.temperature_2m_max[0]),
        lo: Math.round(daily.temperature_2m_min[0]),
        sunset: sunset,
        days: days
      };
    });
  }

  return { configured: configured, get: get };
})();
