// Historical regression source. Not run by portfolio scripts; see tests/README.md for requirements and limits.
/** Remove every task-facing clause that still asks for the chosen response. */
function removeSemanticRemediation(lab, concept, hasRemediationConcept) {
  const strip = (value) => String(value || "")
    .split(/(?<=[.!?;])\s+|\r?\n+/)
    .filter((clause) => !hasRemediationConcept(concept, clause))
    .join(" ")
    .trim();
  return {
    ...lab,
    title: strip(lab.title),
    objective: strip(lab.objective),
    scenario: strip(lab.scenario),
    tasks: (lab.tasks || []).map((task) => ({
      ...task,
      title: strip(task.title),
      description: strip(task.description),
      deliverable: strip(task.deliverable),
    })),
    hints: (lab.hints || []).map(strip),
    outcomes: (lab.outcomes || []).map(strip),
    learningOutcomes: (lab.learningOutcomes || []).map(strip),
  };
}

module.exports = { removeSemanticRemediation };
