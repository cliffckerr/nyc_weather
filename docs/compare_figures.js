/* Compare the figures of figures.js with the reference that compare_figures.py makes from streamlit_app.py; run through that script */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const tolerance = 1e-6;
const colorTolerance = 1; // Python and JS can round a color channel differently
const maxShown = 2; // Differences to print of each kind

const names = 'parseData daylightFigure daylightRadialFigure dailyNormals yearlyMeans temperatureFigure temperatureRadialFigure yearlyFigure yearlyRadialFigure temperatureDaylightFigure dayChances precipitationFigure precipitationBars typicalPeriod actualPeriod dateYear';
const context = vm.createContext({});
vm.runInContext(`${fs.readFileSync(path.join(__dirname, 'figures.js'), 'utf8')}\nthis.site = {${names.split(' ').join(', ')}};`, context);
const site = context.site;
const df = site.parseData(fs.readFileSync(path.join(__dirname, 'weather.csv'), 'utf8'));
const reference = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));

let checked = 0;
const differences = new Map();


function report(where, python, javascript) {
    /* Record a difference, printing the first few of each kind */
    const kind = where.replace(/\[\d+\]/g, '[]').replace(/^.*?: /, '');
    differences.set(kind, (differences.get(kind) ?? 0) + 1);
    if (differences.get(kind) <= maxShown) {
        console.log(`${where}\n  Python: ${JSON.stringify(python)?.slice(0, 120)}\n  JS:     ${JSON.stringify(javascript)?.slice(0, 120)}`);
    }
}


function comparable(value) {
    /* Drop the midnight time that Python adds to dates */
    return typeof value === 'string' ? value.replace(/T00:00:00(\.0+)?$/, '') : value;
}


function colorChannels(value) {
    /* Get the channels of an 'rgb(...)' string, or null for anything else */
    const match = /^rgb\((\d+), (\d+), (\d+)\)$/.exec(value);
    return match ? match.slice(1).map(Number) : null;
}


function compare(python, javascript, where) {
    /* Compare two JSON values, recursively */
    const [left, right] = [comparable(python), comparable(javascript)];
    if (left === null || left === undefined) {
        if (right === null || right === undefined) {
            return;
        }
    }
    if (Array.isArray(left) && Array.isArray(right)) {
        if (left.length !== right.length) {
            report(`${where}.length`, left.length, right.length);
            return;
        }
        left.forEach((item, i) => compare(item, right[i], `${where}[${i}]`));
    } else if (left && right && typeof left === 'object' && typeof right === 'object') {
        for (const key of new Set([...Object.keys(left), ...Object.keys(right)])) {
            compare(left[key], right[key], `${where}.${key}`);
        }
    } else {
        checked += 1;
        const [leftColor, rightColor] = [colorChannels(left), colorChannels(right)];
        const same = typeof left === 'number' && typeof right === 'number' ? Math.abs(left - right) <= tolerance
            : leftColor && rightColor ? leftColor.every((channel, i) => Math.abs(channel - rightColor[i]) <= colorTolerance)
                : left === right;
        if (!same) {
            report(where, left, right);
        }
    }
}


function plain(value) {
    /* Bring a value out of the vm context as plain JSON, which turns NaN into null as on the Python side */
    return JSON.parse(JSON.stringify(value));
}


compare(reference.daylightFigure, plain(site.daylightFigure(df)), 'daylightFigure: ');
compare(reference.daylightRadialFigure, plain(site.daylightRadialFigure(df)), 'daylightRadialFigure: ');
for (const {start, stop, figures, typical, actual} of reference.cases) {
    const selected = df.filter(row => site.dateYear(row.date) >= start && site.dateYear(row.date) <= stop);
    const normals = site.dailyNormals(selected);
    const table = site.yearlyMeans(selected);
    const built = {
        temperatureFigure: site.temperatureFigure(normals),
        temperatureRadialFigure: site.temperatureRadialFigure(normals),
        yearlyFigure: site.yearlyFigure(table),
        yearlyRadialFigure: site.yearlyRadialFigure(table),
        temperatureDaylightFigure: site.temperatureDaylightFigure(site.dailyNormals(selected, ['tmax_c', 'daylight_hours'])),
    };
    for (const kind of ['Rainfall', 'Snowfall']) {
        const chances = site.dayChances(selected, kind);
        built[`precipitationFigure${kind}`] = site.precipitationFigure(chances, kind);
        built[`precipitationBars${kind}`] = site.precipitationBars(chances, kind);
    }
    for (const [name, figure] of Object.entries(built)) {
        compare(figures[name], plain(figure), `${start}-${stop} ${name}: `);
    }
    const siteTypical = site.typicalPeriod(normals);
    const siteActual = site.actualPeriod(selected);
    for (const label of ['warmest', 'coldest']) {
        compare(typical[label], [siteTypical[label].dates, siteTypical[label].temperature], `${start}-${stop} typical: ${label}`);
        compare(actual[label], [siteActual[label].dates, siteActual[label].temperature], `${start}-${stop} actual: ${label}`);
    }
}

const total = [...differences.values()].reduce((sum, count) => sum + count, 0);
console.log(`Compared ${checked} values: ${total} differences`);
process.exitCode = total ? 1 : 0;
