"""
Download daily NYC (Central Park) weather and merge it into a single CSV.

Raw downloads go in data/raw/ and are reused if present; delete them to refresh.
The merged result is data/nyc_weather.csv.

Sources:
    station_* columns: NOAA GHCN-Daily, Central Park station USW00094728 (measured)
    era5_* columns: Open-Meteo archive, ERA5 reanalysis (modeled, ~25 km grid cell)
"""
import time
import json
from pathlib import Path

import numpy as np
import pandas as pd
import requests

start_year = 1975
end_date = pd.Timestamp.today().normalize() - pd.Timedelta(days=7)  # ERA5 lags by about 5 days
lat, lon = 40.7789, -73.9692  # Central Park

data_dir = Path(__file__).parent / 'data'
raw_dir = data_dir / 'raw'
noaa_file = raw_dir / 'ghcn_USW00094728.csv'
noaa_url = 'https://www.ncei.noaa.gov/data/global-historical-climatology-network-daily/access/USW00094728.csv'
era5_url = 'https://archive-api.open-meteo.com/v1/archive'
era5_vars = [
    'temperature_2m_max', 'temperature_2m_min', 'precipitation_sum', 'snowfall_sum',
    'relative_humidity_2m_mean', 'cloud_cover_mean', 'wind_speed_10m_max', 'wind_gusts_10m_max',
    'sunrise', 'sunset', 'daylight_duration',
]


def download_noaa():
    """Download the full station record"""
    if noaa_file.exists():
        return
    response = requests.get(noaa_url, timeout=300)
    response.raise_for_status()
    noaa_file.write_bytes(response.content)


def download_era5():
    """Download ERA5 in 10-year chunks, to stay within the API's request limits"""
    for year in range(start_year, end_date.year + 1, 10):
        file = raw_dir / f'era5_{year}.json'
        if file.exists():
            continue
        params = dict(
            latitude=lat, longitude=lon, models='era5', timezone='America/New_York',
            start_date=f'{year}-01-01', end_date=min(pd.Timestamp(f'{year + 9}-12-31'), end_date).strftime('%Y-%m-%d'),
            daily=','.join(era5_vars), temperature_unit='fahrenheit', wind_speed_unit='mph', precipitation_unit='inch',
        )
        for attempt in range(5):
            response = requests.get(era5_url, params=params, timeout=300)
            if response.status_code != 429:
                break
            time.sleep(65)  # The per-minute limit has been hit
        response.raise_for_status()
        file.write_text(response.text)
        time.sleep(5)


def load_noaa():
    """Load the station data, converting from GHCN units to imperial"""
    columns = ['DATE', 'TMAX', 'TMIN', 'PRCP', 'SNOW', 'SNWD', 'AWND', 'WSF2', 'WSF5']
    df = pd.read_csv(noaa_file, usecols=columns, parse_dates=['DATE'], low_memory=False).set_index('DATE')
    out = pd.DataFrame(index=df.index)
    out['station_tmax_f'] = df.TMAX / 10 * 9 / 5 + 32  # Tenths of a degree C
    out['station_tmin_f'] = df.TMIN / 10 * 9 / 5 + 32
    out['station_precip_in'] = df.PRCP / 10 / 25.4  # Tenths of a mm
    out['station_snow_in'] = df.SNOW / 25.4  # mm
    out['station_snow_depth_in'] = df.SNWD / 25.4
    mph = 2.23694  # Per m/s
    out['station_wind_avg_mph'] = df.AWND / 10 * mph  # Tenths of a m/s
    out['station_wind_max_2min_mph'] = df.WSF2 / 10 * mph
    out['station_wind_max_5sec_mph'] = df.WSF5 / 10 * mph
    return out


def load_era5():
    """Load and join the ERA5 chunks"""
    dfs = []
    for file in sorted(raw_dir.glob('era5_*.json')):
        raw = json.loads(file.read_text())
        df = pd.DataFrame(raw['daily'])
        for key in ['sunrise', 'sunset']:  # Given at a fixed UTC offset all year, so convert to local clock time
            utc = pd.to_datetime(df[key]) - pd.Timedelta(seconds=raw['utc_offset_seconds'])
            df[key] = utc.dt.tz_localize('UTC').dt.tz_convert('America/New_York').dt.strftime('%H:%M')
        dfs.append(df)
    df = pd.concat(dfs)
    df['time'] = pd.to_datetime(df['time'])
    df = df.set_index('time')
    return pd.DataFrame(dict(
        era5_tmax_f=df.temperature_2m_max,
        era5_tmin_f=df.temperature_2m_min,
        era5_precip_in=df.precipitation_sum,
        era5_snow_in=df.snowfall_sum,
        era5_humidity_pct=df.relative_humidity_2m_mean,
        era5_cloud_pct=df.cloud_cover_mean,
        era5_wind_max_mph=df.wind_speed_10m_max,
        era5_gust_max_mph=df.wind_gusts_10m_max,
        sunrise=df.sunrise,
        sunset=df.sunset,
        daylight_hours=np.round(df.daylight_duration / 3600, 2),
    ))


def make_metric(noaa, era5):
    """Convert to metric, keeping only the best source where the station and ERA5 measure the same thing"""
    kmh = 1.60934  # Per mph
    return pd.DataFrame(dict(
        tmax_c=(noaa.station_tmax_f - 32) * 5 / 9,
        tmin_c=(noaa.station_tmin_f - 32) * 5 / 9,
        precip_mm=noaa.station_precip_in * 25.4,
        snow_cm=noaa.station_snow_in * 2.54,
        snow_depth_cm=noaa.station_snow_depth_in * 2.54,
        station_wind_avg_kmh=noaa.station_wind_avg_mph * kmh,
        station_wind_max_2min_kmh=noaa.station_wind_max_2min_mph * kmh,
        station_wind_max_5sec_kmh=noaa.station_wind_max_5sec_mph * kmh,
        era5_wind_max_kmh=era5.era5_wind_max_mph * kmh,
        era5_gust_max_kmh=era5.era5_gust_max_mph * kmh,
    )).round(1).join(era5[['era5_humidity_pct', 'era5_cloud_pct', 'sunrise', 'sunset', 'daylight_hours']], how='outer')


def finalize(df):
    """Trim to the study period and ensure one row per day"""
    return df.loc[f'{start_year}-01-01':end_date].asfreq('D').rename_axis('date')


def main():
    raw_dir.mkdir(parents=True, exist_ok=True)
    download_noaa()
    download_era5()
    noaa = load_noaa()
    era5 = load_era5()
    df = finalize(noaa.round(1).join(era5, how='outer'))
    df.to_csv(data_dir / 'nyc_weather.csv')
    finalize(make_metric(noaa, era5)).to_csv(data_dir / 'nyc_weather_metric.csv')
    print(f'Wrote {len(df)} days, {df.index[0].date()} to {df.index[-1].date()}')
    print(df.notna().mean().round(3).to_string())


if __name__ == '__main__':
    main()
