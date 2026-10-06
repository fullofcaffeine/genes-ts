import Main.ReviewState;

/** Direct module functions share the same declared-return contract as methods. */
function reviewFromText(raw: Null<String>): DomainResult<ReviewState> {
  return switch raw {
    case "approved": DomainResult.Value(ReviewState.Approved);
    case "pending": DomainResult.Value(ReviewState.Pending);
    case _: DomainResult.Invalid;
  };
}
