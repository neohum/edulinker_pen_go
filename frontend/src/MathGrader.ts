export type MathGradeResult = {
    kind: 'waiting' | 'graded';
    orientation: 'horizontal' | 'vertical';
    expression: string;
    expected: number;
    answer?: number;
    correct?: boolean;
};

const EPSILON = 1e-9;

export function gradeMathText(text: string): MathGradeResult | null {
    const normalized = normalizeMathText(text);
    if (!/[0-9]/.test(normalized)) return null;

    const vertical = parseVerticalEquation(normalized);
    if (vertical) return vertical;

    return parseHorizontalEquation(normalized);
}

function normalizeMathText(text: string): string {
    return text
        .replace(/[０-９]/g, ch => String(ch.charCodeAt(0) - '０'.charCodeAt(0)))
        .replace(/[，、]/g, ',')
        .replace(/[．。·ㆍ]/g, '.')
        .replace(/[＋]/g, '+')
        .replace(/[－−]/g, '-')
        .replace(/[×✕xX]/g, '*')
        .replace(/[÷]/g, '/')
        .replace(/[＝]/g, '=')
        .replace(/[—–ㅡ]/g, '-')
        .replace(/[\[｛{]/g, '(')
        .replace(/[\]｝}]/g, ')');
}

function parseHorizontalEquation(text: string): MathGradeResult | null {
    const oneLine = text.replace(/\s+/g, '');
    const eq = oneLine.indexOf('=');
    if (eq < 0) return null;

    const left = oneLine.slice(0, eq);
    const right = oneLine.slice(eq + 1);
    if (!left || !/[+\-*/]/.test(left)) return null;

    const expected = evaluateExpression(left);
    if (expected == null) return null;

    if (right.length === 0) {
        return {
            kind: 'waiting',
            orientation: 'horizontal',
            expression: left,
            expected,
        };
    }

    const answer = parseNumber(right);
    if (answer == null) return null;

    return {
        kind: 'graded',
        orientation: 'horizontal',
        expression: left,
        expected,
        answer,
        correct: nearlyEqual(expected, answer),
    };
}

function parseVerticalEquation(text: string): MathGradeResult | null {
    const lines = text
        .split(/\n+/)
        .map(line => line.trim())
        .filter(Boolean);
    if (lines.length < 2) return null;

    const separatorIndex = lines.findIndex(line => /^[-_=]{2,}$/.test(line.replace(/\s+/g, '')));
    const before = separatorIndex >= 0 ? lines.slice(0, separatorIndex) : lines.slice(0, -1);
    const after = separatorIndex >= 0 ? lines.slice(separatorIndex + 1) : lines.slice(-1);

    if (before.length < 2) return null;

    let operator = '';
    const operands: number[] = [];

    for (const raw of before) {
        const compact = raw.replace(/\s+/g, '');
        const lineOperator = compact.match(/[+\-*/]/)?.[0] ?? '';
        if (lineOperator) operator = lineOperator;

        const withoutOperator = compact.replace(/[+\-*/=]/g, '');
        const value = parseNumber(withoutOperator);
        if (value == null) return null;
        operands.push(value);
    }

    if (!operator || operands.length < 2) return null;
    const expression = operands.map((n, i) => i === 0 ? formatNumber(n) : `${operator}${formatNumber(n)}`).join('');
    const expected = evaluateExpression(expression);
    if (expected == null) return null;

    const answerText = after.join('').replace(/\s+/g, '').replace(/[=]/g, '');
    if (!answerText) {
        return {
            kind: 'waiting',
            orientation: 'vertical',
            expression,
            expected,
        };
    }

    const answer = parseNumber(answerText);
    if (answer == null) return null;

    return {
        kind: 'graded',
        orientation: 'vertical',
        expression,
        expected,
        answer,
        correct: nearlyEqual(expected, answer),
    };
}

function parseNumber(text: string): number | null {
    if (!text) return null;
    const normalized = text.replace(/,/g, '');
    if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(normalized)) return null;
    const n = Number(normalized);
    return Number.isFinite(n) ? n : null;
}

function evaluateExpression(expression: string): number | null {
    const parser = new ExpressionParser(expression.replace(/,/g, ''));
    const value = parser.parseExpression();
    if (value == null || !parser.isDone()) return null;
    return Number.isFinite(value) ? value : null;
}

function nearlyEqual(a: number, b: number): boolean {
    return Math.abs(a - b) <= Math.max(EPSILON, Math.abs(a) * EPSILON);
}

function formatNumber(value: number): string {
    return Number.isInteger(value) ? String(value) : String(value);
}

class ExpressionParser {
    private i = 0;

    constructor(private readonly src: string) {}

    parseExpression(): number | null {
        let value = this.parseTerm();
        if (value == null) return null;

        while (this.peek() === '+' || this.peek() === '-') {
            const op = this.src[this.i++];
            const rhs = this.parseTerm();
            if (rhs == null) return null;
            value = op === '+' ? value + rhs : value - rhs;
        }

        return value;
    }

    isDone(): boolean {
        return this.i >= this.src.length;
    }

    private parseTerm(): number | null {
        let value = this.parseFactor();
        if (value == null) return null;

        while (this.peek() === '*' || this.peek() === '/') {
            const op = this.src[this.i++];
            const rhs = this.parseFactor();
            if (rhs == null) return null;
            if (op === '/' && Math.abs(rhs) <= EPSILON) return null;
            value = op === '*' ? value * rhs : value / rhs;
        }

        return value;
    }

    private parseFactor(): number | null {
        if (this.peek() === '+') {
            this.i++;
            return this.parseFactor();
        }
        if (this.peek() === '-') {
            this.i++;
            const value = this.parseFactor();
            return value == null ? null : -value;
        }
        if (this.peek() === '(') {
            this.i++;
            const value = this.parseExpression();
            if (this.peek() === ')') this.i++;
            return value;
        }

        const start = this.i;
        while (/[0-9.]/.test(this.peek())) this.i++;
        if (start === this.i) return null;

        return parseNumber(this.src.slice(start, this.i));
    }

    private peek(): string {
        return this.src[this.i] ?? '';
    }
}
