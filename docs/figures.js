/* Calculations and Plotly figures for NYC weather: a translation of the functions of the same names in streamlit_app.py */

const daylightYear = 2025;
const placeholderYear = 2025; // Only a placeholder non-leap year
const leapYear = 2024; // Placeholder year that has a Feb 29, for charts of the precipitation calendar
const windowDays = 90; // Days in the warmest/coldest periods
const temperatureLabel = 'Temperature (°C)';
const daylightOuter = 29; // Hours at the end of the radial daylight axis, which puts the month labels clear of the event labels outside the 24:00 rim
const radialRim = 30; // °C at the edge of the radial charts; lines may run past it
const radialRimLimit = 35; // Above this temperature, the rim moves out to the next multiple of 10 °C

// Colors, also set in style.css
const night = '#2b3147';
const gold = '#f2bb3d';
const warm = '#e0672f';
const cool = '#4493dc';
const ink = '#e8e9ee';
const muted = '#a4a9b8';
const grid = '#3a4158';
const bandColor = 'rgba(242,187,61,0.16)';
const snowWhite = '#ffffff';
const transparent = 'rgba(0,0,0,0)';

// plotly.js has no built-in Turbo colorscale, so these are the stops of plotly.colors.sequential.Turbo
const turbo = ['#30123b', '#4145ab', '#4675ed', '#39a2fc', '#1bcfd4', '#24eca6', '#61fc6c', '#a4fc3b', '#d1e834', '#f3c63a', '#fe9b2d', '#f36315', '#d93806', '#b11901', '#7a0402'];
const turboScale = turbo.map((color, i) => [i / (turbo.length - 1), color]);

// Local dates in New York for the daylight year; the DST dates are checked against the data
const events = {
    [`${daylightYear}-03-09`]: 'Clocks forward',
    [`${daylightYear}-03-20`]: 'Spring equinox',
    [`${daylightYear}-06-20`]: 'Summer solstice',
    [`${daylightYear}-09-22`]: 'Fall equinox',
    [`${daylightYear}-11-02`]: 'Clocks back',
    [`${daylightYear}-12-21`]: 'Winter solstice',
};

const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const range = (start, stop, step = 1) => Array.from({length: Math.max(Math.ceil((stop - start) / step), 0)}, (_, i) => start + i * step);
const pad = number => String(number).padStart(2, '0');
const dateYear = date => Number(date.slice(0, 4));
const dateMonth = date => Number(date.slice(5, 7));
const dateDay = date => Number(date.slice(8, 10));
const monthDay = date => date.slice(5);
const shortDate = date => `${monthNames[dateMonth(date) - 1]} ${dateDay(date)}`;
const isLeapDay = date => monthDay(date) === '02-29';
const isMissing = value => value === null || value === undefined || Number.isNaN(value);


function parseData(csv) {
    /* Parse the CSV into a list of one object per day; missing numbers become NaN */
    const [header, ...lines] = csv.trim().split('\n');
    const columns = header.trim().split(',');
    const text = new Set(['date', 'sunrise', 'sunset']);
    return lines.map(line => {
        const values = line.trim().split(',');
        return Object.fromEntries(columns.map((column, i) => [column, text.has(column) ? values[i] : (values[i] === '' ? NaN : Number(values[i]))]));
    });
}


function mean(values) {
    /* Average the values, skipping any that are missing */
    const present = values.filter(value => !isMissing(value));
    return present.length ? present.reduce((total, value) => total + value, 0) / present.length : NaN;
}


function dayMean(row) {
    /* Find the mean temperature of a day */
    return mean([row.tmin_c, row.tmax_c]);
}


function rollingMeans(values, size) {
    /* Average each run of consecutive values, labeled by its last position; runs with a missing value are NaN */
    return values.map((_, last) => {
        if (last < size - 1) {
            return NaN;
        }
        let total = 0;
        for (let i = last - size + 1; i <= last; i++) {
            total += values[i];
        }
        return total / size;
    });
}


function extremePositions(values) {
    /* Find the position of the first largest and first smallest value, skipping NaN */
    let warmest = -1;
    let coldest = -1;
    values.forEach((value, i) => {
        if (Number.isNaN(value)) {
            return;
        }
        if (warmest < 0 || value > values[warmest]) {
            warmest = i;
        }
        if (coldest < 0 || value < values[coldest]) {
            coldest = i;
        }
    });
    return {warmest, coldest};
}


function clockHours(time) {
    /* Convert an 'HH:MM' string to decimal hours */
    const [hours, minutes] = time.split(':').map(Number);
    return hours + minutes / 60;
}


function dayOfYear(date) {
    /* Find the day of the year of a date, with Jan 1 as 1 */
    return (Date.UTC(dateYear(date), dateMonth(date) - 1, dateDay(date)) - Date.UTC(dateYear(date), 0, 1)) / 86400000 + 1;
}


function dayAngle(date) {
    /* Convert a date to degrees clockwise from Jan 1 at the top of a 365-day circle */
    return (dayOfYear(date) - 1) / 365 * 360;
}


function yearDates(year = placeholderYear) {
    /* List every date of a year as 'YYYY-MM-DD' */
    const days = [];
    for (let time = Date.UTC(year, 0, 1); new Date(time).getUTCFullYear() === year; time += 86400000) {
        days.push(new Date(time).toISOString().slice(0, 10));
    }
    return days;
}


function dayCustomData(year) {
    /* Make the hover data of the daylight charts */
    return year.map(row => [shortDate(row.date), row.sunrise, row.sunset, row.daylight_hours]);
}


const daylightHover = '<b>%{customdata[0]}</b><br>Sunrise %{customdata[1]}<br>Sunset %{customdata[2]}<br>%{customdata[3]:.1f} h daylight<extra></extra>';


function daylightFigure(df) {
    /* Make one horizontal bar per day from sunrise to sunset, with Jan 1 at the top */
    const year = df.filter(row => dateYear(row.date) === daylightYear);
    const rise = year.map(row => clockHours(row.sunrise));
    const dates = year.map(row => row.date);
    const shapes = [];
    const annotations = [];
    for (const [date, label] of Object.entries(events)) {
        const y = dates.indexOf(date);
        shapes.push({type: 'line', x0: 0, x1: 24, y0: y, y1: y, line: {color: ink, width: 1, dash: 'dot'}});
        annotations.push({x: 1, xref: 'paper', y, text: `${label}, ${shortDate(date)}`, showarrow: false, xanchor: 'left', xshift: 8, font: {color: ink, size: 12}});
    }
    const monthStarts = dates.filter(date => dateDay(date) === 1);
    const hours = range(0, 25, 3);
    return {
        data: [{
            type: 'bar', y: range(0, year.length), x: year.map((row, i) => clockHours(row.sunset) - rise[i]), base: rise, orientation: 'h', marker: {color: gold, line: {width: 0}},
            customdata: dayCustomData(year), hovertemplate: daylightHover,
        }],
        layout: {
            shapes, annotations, height: 860, bargap: 0.2, plot_bgcolor: night, paper_bgcolor: transparent, font: {color: ink},
            margin: {l: 45, r: 170, t: 30, b: 10}, showlegend: false, hovermode: 'y',
            yaxis: {
                range: [year.length - 0.5, -0.5], tickvals: monthStarts.map(date => dates.indexOf(date)),
                ticktext: monthStarts.map(date => monthNames[dateMonth(date) - 1]), ticks: 'outside', ticklen: 4, tickcolor: muted, showgrid: false, zeroline: false,
            },
            xaxis: {
                range: [0, 24], tickvals: hours, ticktext: hours.map(hour => `${pad(hour)}:00`),
                side: 'top', showgrid: true, gridcolor: grid, zeroline: false,
            },
        },
    };
}


function daylightRadialFigure(df) {
    /* Make one wedge per day from sunrise to sunset, with midnight at the center and Jan 1 at the top, running clockwise */
    const year = df.filter(row => dateYear(row.date) === daylightYear);
    const rise = year.map(row => clockHours(row.sunrise));
    const data = [{
        type: 'barpolar', r: year.map((row, i) => clockHours(row.sunset) - rise[i]), base: rise, theta: year.map(row => dayAngle(row.date)), width: 360 / 365,
        marker: {color: gold, line: {color: gold, width: 0.5}}, // The outline closes the seams between wedges
        customdata: dayCustomData(year), hovertemplate: daylightHover,
    }];
    for (const [date, label] of Object.entries(events)) {
        const angle = dayAngle(date);
        data.push({type: 'scatterpolar', r: [0, 24], theta: [angle, angle], mode: 'lines', line: {color: ink, width: 1, dash: 'dot'}, hoverinfo: 'skip'});
        data.push({
            type: 'scatterpolar', r: [24.5], theta: [angle], mode: 'text', text: [`${label}, ${shortDate(date)}`], hoverinfo: 'skip',
            textposition: `middle ${angle < 180 ? 'right' : 'left'}`, textfont: {color: ink, size: 12},
        });
    }
    const hours = range(0, 25, 3);
    const labels = hours.map(hour => `${pad(hour)}:00`);
    const firstRise = rise[0];
    const firstSet = clockHours(year[0].sunset);
    data.push({ // Drawn as text rather than axis labels, so that those over the daylight can be dark
        type: 'scatterpolar', r: hours, theta: hours.map(() => 0), mode: 'text', text: labels, textposition: 'middle right', hoverinfo: 'skip',
        textfont: {size: 11, color: hours.map(hour => (firstRise < hour && hour < firstSet ? night : muted))},
    });
    const figure = styleRadialFigure({data, layout: {}}, hours, labels, daylightOuter);
    figure.layout.polar.radialaxis.showticklabels = false;
    figure.layout.height = 860;
    figure.layout.showlegend = false;
    return figure;
}


function dailyNormals(df, columns = ['tmin_c', 'tmax_c']) {
    /* Average the columns for each calendar day; Feb 29 is left out to give a fixed 365-day year. Days without data, as in a partial year, stay as NaN */
    const days = new Map();
    for (const row of df) {
        if (!isLeapDay(row.date)) {
            const key = monthDay(row.date);
            days.set(key, [...(days.get(key) ?? []), row]);
        }
    }
    return yearDates().map(date => {
        const rows = days.get(monthDay(date)) ?? [];
        return Object.fromEntries([['date', date], ...columns.map(column => [column, mean(rows.map(row => row[column]))])]);
    });
}


function styleYearFigure(figure, yTitle, year = placeholderYear) {
    /* Apply the January to December x-axis and the layout shared by the charts of a year */
    Object.assign(figure.layout, {
        xaxis: {tickformat: '%b', dtick: 'M1', tick0: `${year}-01-01`, hoverformat: '%b %-d', showgrid: true, gridcolor: grid, gridwidth: 0.5, range: [`${year}-01-01`, `${year}-12-31`]},
        yaxis: {title: {text: yTitle}, gridcolor: grid, zeroline: true, zerolinecolor: muted, zerolinewidth: 1},
        height: 520, plot_bgcolor: transparent, paper_bgcolor: transparent, font: {color: ink},
        margin: {l: 55, r: 20, t: 40, b: 30},
    });
    return figure;
}


function temperatureFigure(normals) {
    /* Plot the average min and max as two lines with the range filled between */
    const x = normals.map(day => day.date);
    const figure = styleYearFigure({
        data: [
            {type: 'scatter', x, y: normals.map(day => day.tmin_c), name: 'Average min', line: {color: cool, width: 2}, hovertemplate: '%{y:.1f} °C'},
            {type: 'scatter', x, y: normals.map(day => day.tmax_c), name: 'Average max', line: {color: warm, width: 2}, hovertemplate: '%{y:.1f} °C', fill: 'tonexty', fillcolor: bandColor},
        ],
        layout: {},
    }, temperatureLabel);
    return Object.assign(figure, {layout: {...figure.layout, hovermode: 'x unified', legend: {orientation: 'h', x: 0, y: 1.1}}});
}


function temperatureRadialFigure(normals) {
    /* Plot the average min and max around the circle with the range filled between, joining Dec 31 to Jan 1 for a full year */
    const closed = normals.filter(day => !isMissing(day.tmin_c) && !isMissing(day.tmax_c));
    const theta = closed.map(day => dayAngle(day.date));
    const labels = closed.map(day => shortDate(day.date));
    if (closed.length === 365) {
        closed.push(closed[0]);
        theta.push(360);
        labels.push(labels[0]);
    }
    const data = [{ // A loop out along the max and back along the min, which leaves a ring to fill
        type: 'scatterpolar', r: [...closed.map(day => day.tmax_c), ...closed.map(day => day.tmin_c).reverse()], theta: [...theta, ...[...theta].reverse()],
        mode: 'none', fill: 'toself', fillcolor: bandColor, hoverinfo: 'skip', showlegend: false,
    }];
    for (const [column, name, color] of [['tmin_c', 'Average min', cool], ['tmax_c', 'Average max', warm]]) {
        data.push({
            type: 'scatterpolar', r: closed.map(day => day[column]), theta, name, mode: 'lines', line: {color, width: 2},
            customdata: labels, hovertemplate: '%{customdata}: %{r:.1f} °C',
        });
    }
    const lowest = Math.min(...closed.map(day => day.tmin_c));
    const highest = Math.max(...closed.map(day => day.tmax_c));
    const figure = styleRadialTemperature({data, layout: {}}, lowest, highest);
    figure.layout.legend = {orientation: 'h', x: 0, y: 1.08};
    return figure;
}


function yearlyMeans(df) {
    /* Make a table of the daily mean temperature with one row per calendar day and one column per year; Feb 29 is left out. Days without data stay as NaN */
    const dates = yearDates();
    const rowOfDay = new Map(dates.map((date, i) => [monthDay(date), i]));
    const years = [...new Set(df.map(row => dateYear(row.date)))].sort((a, b) => a - b);
    const columns = new Map(years.map(year => [year, dates.map(() => NaN)]));
    for (const row of df) {
        if (!isLeapDay(row.date)) {
            columns.get(dateYear(row.date))[rowOfDay.get(monthDay(row.date))] = dayMean(row);
        }
    }
    return {dates, years, columns};
}


function yearColor(year, first, last) {
    /* Pick the color of a year from the colormap */
    const position = (year - first) / Math.max(last - first, 1) * (turbo.length - 1);
    const low = Math.min(Math.floor(position), turbo.length - 2);
    const channels = color => [1, 3, 5].map(i => parseInt(color.slice(i, i + 2), 16));
    const lower = channels(turbo[low]);
    const upper = channels(turbo[low + 1]);
    return `rgb(${lower.map((channel, i) => Math.round(channel + (position - low) * (upper[i] - channel))).join(', ')})`;
}


function yearColorbar(first, last) {
    /* Make the marker settings for an invisible trace that exists only to draw the colorbar */
    return {colorscale: turboScale, cmin: first, cmax: last, color: [first], showscale: true, colorbar: {title: {text: 'Year'}, tickformat: 'd', outlinewidth: 0}};
}


function yearlyFigure(table) {
    /* Plot one line per year, colored from earliest to latest, with a colorbar in place of a legend */
    const {dates, years, columns} = table;
    const first = years[0];
    const last = years.at(-1);
    const data = years.map(year => ({
        type: 'scattergl', x: dates, y: columns.get(year), name: String(year), mode: 'lines', line: {color: yearColor(year, first, last), width: 1}, opacity: 0.7,
        hovertemplate: '%{x|%b %-d}, %{fullData.name}: %{y:.1f} °C<extra></extra>',
    }));
    data.push({type: 'scatter', x: [null], y: [null], mode: 'markers', showlegend: false, hoverinfo: 'skip', marker: yearColorbar(first, last)});
    const figure = styleYearFigure({data, layout: {}}, temperatureLabel);
    return Object.assign(figure, {layout: {...figure.layout, hovermode: 'closest', showlegend: false}});
}


function yearlyRadialFigure(table) {
    /* Plot one line per year around the circle, colored from earliest to latest, with a colorbar in place of a legend */
    const {dates, years, columns} = table;
    const first = years[0];
    const last = years.at(-1);
    const theta = dates.map(dayAngle);
    const labels = dates.map(shortDate);
    const data = years.map(year => ({ // Not WebGL, which would hide the axis labels
        type: 'scatterpolar', r: columns.get(year), theta, name: String(year), mode: 'lines', line: {color: yearColor(year, first, last), width: 1}, opacity: 0.7,
        customdata: labels, hovertemplate: '%{customdata}, %{fullData.name}: %{r:.1f} °C<extra></extra>',
    }));
    data.push({type: 'scatterpolar', r: [null], theta: [null], mode: 'markers', showlegend: false, hoverinfo: 'skip', marker: yearColorbar(first, last)});
    const values = [...columns.values()].flat().filter(value => !isMissing(value));
    const figure = styleRadialTemperature({data, layout: {}}, Math.min(...values), Math.max(...values));
    figure.layout.showlegend = false;
    return figure;
}


function styleRadialTemperature(figure, lowest, highest) {
    /* Set up a temperature chart with circles every 10 °C; the center is the lowest value rounded down to a multiple of 10 °C */
    const center = Math.floor(lowest / 10) * 10;
    const rim = highest <= radialRimLimit ? radialRim : Math.ceil(highest / 10) * 10;
    const circles = range(center, rim + 1, 10);
    const labels = circles.map(circle => `${circle} °C`.replace('-', '−'));
    return styleRadialFigure(figure, circles, labels, Math.max(rim, radialRimLimit), 0);
}


function styleRadialFigure(figure, circles, labels, outer, thickCircle = null) {
    /* Apply the labeled circles, the month spokes, and the layout shared by the radial charts; the first circle is the center and the last is the rim, with the axis running on to outer */
    const center = circles[0];
    const rim = circles.at(-1);
    const monthStarts = range(1, 13).map(month => `${placeholderYear}-${pad(month)}-01`);
    const angles = monthStarts.map(dayAngle);
    const compass = range(0, 361);

    // Plotly cuts lines off at the end of the axis, so the axis can run past the rim, and the rim and spokes are drawn as traces
    const guides = [
        {r: angles.flatMap(() => [center, rim, null]), theta: angles.flatMap(angle => [angle, angle, angle]), line: {color: grid, width: 1}, connectgaps: false},
        {r: compass.map(() => rim), theta: compass, line: {color: muted, width: 1}},
    ];
    if (thickCircle !== null) {
        guides.push({r: compass.map(() => thickCircle), theta: compass, line: {color: muted, width: 3}});
    }
    figure.data.unshift(...guides.map(guide => ({type: 'scatterpolar', mode: 'lines', hoverinfo: 'skip', showlegend: false, ...guide}))); // Draw them under the data

    Object.assign(figure.layout, {
        polar: {
            bgcolor: transparent,
            radialaxis: {
                range: [center, outer], tickvals: circles, ticktext: labels, angle: 90, tickangle: 90,
                gridcolor: grid, showline: false, tickfont: {color: muted},
            },
            angularaxis: {rotation: 90, direction: 'clockwise', tickvals: angles, ticktext: monthNames, ticks: '', showgrid: false, showline: false},
        },
        height: 760, paper_bgcolor: transparent, font: {color: ink}, margin: {l: 40, r: 40, t: 70, b: 40}, hovermode: 'closest',
    });
    return figure;
}


function typicalPeriod(normals) {
    /* Find the warmest and coldest window in the average year, which can wrap past Dec 31 */
    const means = normals.map(dayMean);
    const rolling = rollingMeans([...means, ...means.slice(0, windowDays - 1)], windowDays); // Labeled by the last day of each window
    const size = normals.length;
    return Object.fromEntries(Object.entries(extremePositions(rolling)).map(([label, last]) => {
        const start = normals[(last - windowDays + 1 + size) % size].date;
        const stop = normals[last % size].date;
        return [label, {dates: `${shortDate(start)} to ${shortDate(stop)}`, temperature: rolling[last]}];
    }));
}


function actualPeriod(df) {
    /* Find the warmest and coldest consecutive days that really occurred in the selected years */
    const rolling = rollingMeans(df.map(dayMean), windowDays);
    return Object.fromEntries(Object.entries(extremePositions(rolling)).map(([label, stop]) => (
        [label, {dates: `${df[stop - windowDays + 1].date} to ${df[stop].date}`, temperature: rolling[stop]}]
    )));
}


function temperatureDaylightFigure(normals) {
    /* Plot the average max temperature on the left axis and the hours of daylight on the right axis */
    const x = normals.map(day => day.date);
    const figure = styleYearFigure({
        data: [
            {type: 'scatter', x, y: normals.map(day => day.tmax_c), name: 'Average max temperature', line: {color: warm, width: 2}, hovertemplate: '%{y:.1f} °C'},
            {type: 'scatter', x, y: normals.map(day => day.daylight_hours), name: 'Daylight', yaxis: 'y2', line: {color: gold, width: 2}, hovertemplate: '%{y:.1f} h'},
        ],
        layout: {},
    }, 'Average max temperature (°C)');
    figure.layout.yaxis.title.font = {color: warm};
    figure.layout.yaxis2 = {title: {text: 'Daylight (hours)', font: {color: gold}}, overlaying: 'y', side: 'right', showgrid: false, zeroline: false};
    figure.layout.hovermode = 'x unified';
    figure.layout.legend = {orientation: 'h', x: 0, y: 1.1};
    figure.layout.margin.r = 60;
    return figure;
}


function dayChances(df, kind) {
    /* Make a table of the chance of the kind of precipitation (%) with one row per month and one column per day of the month; days that don't exist stay as NaN */
    const counts = range(0, 12).map(() => range(0, 31).map(() => ({happened: 0, total: 0})));
    for (const row of df) {
        const snowed = row.snow_cm > 0; // A day with both counts as snow
        const happened = kind === 'Snowfall' ? snowed : row.precip_mm > 0 && !snowed;
        const count = counts[dateMonth(row.date) - 1][dateDay(row.date) - 1];
        count.total += 1;
        count.happened += happened ? 1 : 0;
    }
    return counts.map(month => month.map(({happened, total}) => (total ? happened / total * 100 : NaN)));
}


function roundHalfEven(value) {
    /* Round to a whole number the way Python's format does */
    const rounded = Math.round(value);
    return Math.abs(value % 1) === 0.5 && rounded % 2 ? rounded - 1 : rounded;
}


function percentLabel(value) {
    /* Format a percentage to the nearest whole number, or to 1 significant figure below 1%; blank if there is no value */
    if (isMissing(value)) {
        return '';
    }
    return `${value < 1 ? value.toPrecision(1) : roundHalfEven(value)}%`;
}


function kindStyle(kind) {
    /* Pick the color and noun of a kind of precipitation */
    return kind === 'Snowfall' ? {color: snowWhite, noun: 'snow'} : {color: cool, noun: 'rain'};
}


function precipitationFigure(chances, kind) {
    /* Draw a calendar grid with one box per day, shaded in proportion to the chance: blue for rain, white for snow */
    const {color, noun} = kindStyle(kind);
    const labels = chances.map(month => month.map(percentLabel));
    const peak = Math.max(...chances.flat().filter(value => !isMissing(value)));
    const isPale = value => kind === 'Snowfall' && value >= 0.4 * peak; // Boxes that need dark text; Plotly's automatic contrast fails on mid-greys, and all rain boxes suit light text
    const text = chances.map((month, i) => month.map((value, j) => (isPale(value) ? `<span style="color:${night}">${labels[i][j]}</span>` : labels[i][j])));
    return {
        data: [{
            type: 'heatmap', z: chances, x: range(1, 32), y: monthNames, text, texttemplate: '%{text}', textfont: {size: 11, color: ink}, customdata: labels,
            colorscale: [[0, night], [1, color]], zmin: 0, zmax: peak, showscale: false, xgap: 2, ygap: 2, hoverongaps: false,
            hovertemplate: `%{y} %{x}: %{customdata} chance of ${noun}<extra></extra>`,
        }],
        layout: {
            xaxis: {side: 'top', dtick: 1, showgrid: false, zeroline: false, ticks: '', range: [0.5, 31.5]},
            yaxis: {autorange: 'reversed', showgrid: false, zeroline: false, ticks: ''},
            height: 560, plot_bgcolor: transparent, paper_bgcolor: transparent, font: {color: ink},
            margin: {l: 45, r: 10, t: 30, b: 10},
        },
    };
}


function precipitationBars(chances, kind) {
    /* Plot the chance for each calendar day as a bar, from January to December */
    const {color, noun} = kindStyle(kind);
    const days = chances.flatMap((month, i) => month.flatMap((value, j) => (isMissing(value) ? [] : [{date: `${leapYear}-${pad(i + 1)}-${pad(j + 1)}`, value}])));
    const figure = styleYearFigure({
        data: [{
            type: 'bar', x: days.map(day => day.date), y: days.map(day => day.value), marker: {color, line: {width: 0}}, customdata: days.map(day => percentLabel(day.value)),
            hovertemplate: `%{customdata} chance of ${noun}<extra></extra>`,
        }],
        layout: {},
    }, `Chance of ${noun} (%)`, leapYear);
    return Object.assign(figure, {layout: {...figure.layout, bargap: 0, hovermode: 'x unified', showlegend: false}});
}
