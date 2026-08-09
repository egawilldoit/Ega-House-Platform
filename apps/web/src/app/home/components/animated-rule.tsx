import { AnimatedRuleMotion } from "./home-motion";

type AnimatedRuleProps = {
  className?: string;
};

export function AnimatedRule({ className }: AnimatedRuleProps) {
  return <AnimatedRuleMotion className={className} />;
}
