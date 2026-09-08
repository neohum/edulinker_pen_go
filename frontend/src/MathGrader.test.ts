import { describe, it, expect } from 'vitest';
import { gradeMathText } from './MathGrader';

describe('MathGrader', () => {
    describe('Horizontal Equations', () => {
        it('should correctly grade a simple correct addition', () => {
            const result = gradeMathText('1 + 2 = 3');
            expect(result).not.toBeNull();
            expect(result?.kind).toBe('graded');
            expect(result?.orientation).toBe('horizontal');
            expect(result?.expected).toBe(3);
            expect(result?.answer).toBe(3);
            expect(result?.correct).toBe(true);
        });

        it('should correctly grade a simple incorrect addition', () => {
            const result = gradeMathText('1 + 2 = 5');
            expect(result).not.toBeNull();
            expect(result?.kind).toBe('graded');
            expect(result?.orientation).toBe('horizontal');
            expect(result?.expected).toBe(3);
            expect(result?.answer).toBe(5);
            expect(result?.correct).toBe(false);
        });

        it('should identify a waiting horizontal equation', () => {
            const result = gradeMathText('1 + 2 =');
            expect(result).not.toBeNull();
            expect(result?.kind).toBe('waiting');
            expect(result?.orientation).toBe('horizontal');
            expect(result?.expected).toBe(3);
            expect(result?.answer).toBeUndefined();
        });

        it('should handle decimal numbers correctly', () => {
            const result = gradeMathText('1.5 + 2.5 = 4.0');
            expect(result).not.toBeNull();
            expect(result?.kind).toBe('graded');
            expect(result?.expected).toBe(4);
            expect(result?.answer).toBe(4);
            expect(result?.correct).toBe(true);
        });
        
        it('should handle multiplication with x', () => {
            const result = gradeMathText('3 x 4 = 12');
            expect(result).not.toBeNull();
            expect(result?.kind).toBe('graded');
            expect(result?.expected).toBe(12);
            expect(result?.correct).toBe(true);
        });

        it('should correctly evaluate equations with parentheses', () => {
            const result = gradeMathText('2 * (3 + 4) = 14');
            expect(result).not.toBeNull();
            expect(result?.kind).toBe('graded');
            expect(result?.expected).toBe(14);
            expect(result?.answer).toBe(14);
            expect(result?.correct).toBe(true);
        });

        it('should correctly handle nested or bracket equivalents', () => {
            const result = gradeMathText('10 - [ 2 + { 3 * 1 } ] = 5');
            expect(result).not.toBeNull();
            expect(result?.kind).toBe('graded');
            expect(result?.expected).toBe(5);
            expect(result?.correct).toBe(true);
        });
    });

    describe('Vertical Equations', () => {
        it('should correctly grade a vertical addition', () => {
            const verticalText = `
              12
            + 34
            ----
              46
            `;
            const result = gradeMathText(verticalText);
            expect(result).not.toBeNull();
            expect(result?.kind).toBe('graded');
            expect(result?.orientation).toBe('vertical');
            expect(result?.expected).toBe(46);
            expect(result?.answer).toBe(46);
            expect(result?.correct).toBe(true);
        });

        it('should correctly grade an incorrect vertical subtraction', () => {
            const verticalText = `
              100
            -  25
            ====
               85
            `;
            const result = gradeMathText(verticalText);
            expect(result).not.toBeNull();
            expect(result?.kind).toBe('graded');
            expect(result?.orientation).toBe('vertical');
            expect(result?.expected).toBe(75);
            expect(result?.answer).toBe(85);
            expect(result?.correct).toBe(false);
        });

        it('should identify a waiting vertical equation', () => {
            const verticalText = `
              100
            -  25
            ----
            `;
            const result = gradeMathText(verticalText);
            expect(result).not.toBeNull();
            expect(result?.kind).toBe('waiting');
            expect(result?.orientation).toBe('vertical');
            expect(result?.expected).toBe(75);
            expect(result?.answer).toBeUndefined();
        });
    });
    
    describe('Invalid Input', () => {
        it('should return null for non-math text', () => {
            const result = gradeMathText('Hello world!');
            expect(result).toBeNull();
        });

        it('should return null for an incomplete equation without =', () => {
            const result = gradeMathText('1 + 2');
            // Vertical grading needs at least 2 operands, horizontal needs '='
            expect(result).toBeNull();
        });
    });
});
