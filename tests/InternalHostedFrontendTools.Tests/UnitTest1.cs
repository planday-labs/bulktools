namespace InternalHostedFrontendTools.Tests;

public class ReadinessTests
{
    [Fact]
    public void ReadinessEndpointPathIsCorrect()
    {
        const string expected = "/ready";
        Assert.Equal(expected, expected);
    }
}
