import { gradeMathText } from './MathGrader';

self.onmessage = (e: MessageEvent) => {
    const { id, text } = e.data;
    try {
        const result = gradeMathText(text);
        self.postMessage({ id, result, error: null });
    } catch (err: any) {
        self.postMessage({ id, result: null, error: err.message });
    }
};
