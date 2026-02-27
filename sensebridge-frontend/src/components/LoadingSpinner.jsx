const LoadingSpinner = ({ size = 24, color }) => (
    <div
        style={{
            width: size,
            height: size,
            border: `${Math.max(2, size / 10)}px solid var(--border-color)`,
            borderTopColor: color || 'var(--color-primary)',
            borderRadius: '50%',
            animation: 'spin 0.7s linear infinite',
            flexShrink: 0,
        }}
        role="status"
        aria-label="Loading"
    />
);

export default LoadingSpinner;
