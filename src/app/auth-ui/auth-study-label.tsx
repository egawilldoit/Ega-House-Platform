type AuthStudyLabelProps = {
  number: string;
  title: string;
  direction: string;
};

export function AuthStudyLabel({ number, title, direction }: AuthStudyLabelProps) {
  return (
    <div className="auth-study-label" aria-label={`${number}, ${title}, ${direction}`}>
      <span>{number}</span>
      <span>{title}</span>
      <span>{direction}</span>
    </div>
  );
}
