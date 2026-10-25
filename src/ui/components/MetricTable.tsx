/**
 * The shared "what ends up different" table.
 *
 * Both the path diff and the universe diff answer the same question in the
 * same units, so they render the same table. Keeping one component means the
 * two views cannot drift apart in wording, tone or which side they highlight.
 */
import type { StateDiffMetric } from '../../core/compareMetrics';

export function MetricTable({
  metrics,
  aName,
  bName,
  caption,
  empty,
}: {
  metrics: readonly StateDiffMetric[];
  aName: string;
  bName: string;
  caption: string;
  empty: string;
}) {
  if (metrics.length === 0) {
    return <p className="dossier-muted">{empty}</p>;
  }

  return (
    <table className="dossier-table">
      <caption className="sr-only">{caption}</caption>
      <thead>
        <tr>
          <th scope="col">What</th>
          <th scope="col" className="num">
            {aName}
          </th>
          <th scope="col" className="num">
            {bName}
          </th>
          <th scope="col" className="num">
            Difference
          </th>
          <th scope="col">Favours</th>
        </tr>
      </thead>
      <tbody>
        {metrics.map((m) => (
          <MetricRow key={m.key} metric={m} aName={aName} bName={bName} />
        ))}
      </tbody>
    </table>
  );
}

function MetricRow({
  metric,
  aName,
  bName,
}: {
  metric: StateDiffMetric;
  aName: string;
  bName: string;
}) {
  const tone = metric.favours === 'a' ? 'good-a' : metric.favours === 'b' ? 'good-b' : 'flat';
  return (
    <tr>
      <td>{metric.label}</td>
      <td className="num">{metric.aText}</td>
      <td className="num">{metric.bText}</td>
      <td className="num">{metric.deltaText}</td>
      <td>
        {metric.favours === 'a' ? (
          <span className="diff-favours diff-favours-a">{aName}</span>
        ) : metric.favours === 'b' ? (
          <span className="diff-favours diff-favours-b">{bName}</span>
        ) : (
          <span className="dossier-tone-flat">neither</span>
        )}
        <span className={`diff-tone-dot diff-tone-${tone}`} aria-hidden="true" />
      </td>
    </tr>
  );
}
